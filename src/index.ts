import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic } from 'azle';
import express from 'express';

/**
 * Data Structures Overview:
 * - `categoriesStorage` is a `StableBTreeMap` that stores all categories, ensuring persistence across canister upgrades.
 * - `bannedAddressesStorage`, `moderatorsStorage`, and `adminsStorage` are also `StableBTreeMap`s used to store respective roles and banned addresses.
 */

class Message {
   id: string;
   message: string;
   messageDeleted: boolean;
   createdBy: string;
   createdAt: Date;
   likes: string[];
   messageEditHistory: Map<Date, string>;

   constructor(id: string, message: string, createdBy: string) {
      this.id = id;
      this.message = message;
      this.messageDeleted = false;
      this.createdBy = createdBy;
      this.createdAt = new Date();
      this.likes = [];
      this.messageEditHistory = new Map<Date, string>();
   }
}

class Topic extends Message {
   title: string;
   posts: Message[];
   pinned: boolean;
   closed: boolean;
   categoryid: string;
   titleEditHistory: Map<Date, string>;
   mostRecentActivity: Date;

   constructor(id: string, title: string, message: string, categoryid: string, createdBy: string) {
      super(id, message, createdBy);
      this.title = title;
      this.posts = [];
      this.pinned = false;
      this.closed = false;
      this.categoryid = categoryid;
      this.mostRecentActivity = new Date();
      this.titleEditHistory = new Map<Date, string>();
   }
}

class Category {
   id: string;
   name: string;
   topics: Map<string, Topic>;
   pinnedTopics: string[];
   mostRecentTopics: string[];
   createdAt: Date;
   createdBy: string;

   constructor(id: string, name: string, createdBy: string) {
      this.id = id;
      this.name = name;
      this.topics = new Map<string, Topic>();
      this.pinnedTopics = [];
      this.mostRecentTopics = [];
      this.createdAt = new Date();
      this.createdBy = createdBy;
   }
}

// Custom type for error handling from functions
type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
   return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
   return { type: 'Err', error };
}

// Storing important variables in persistent memory using stableBTreeMap
const categoriesStorage = StableBTreeMap<string, Category>(0);
const bannedAddressesStorage = StableBTreeMap<string, string>(1);
const moderatorsStorage = StableBTreeMap<string, string>(2);
const adminsStorage = StableBTreeMap<string, string>(3);

export default Server(() => {
   const app = express();
   app.use(express.json());

   // GET Requests

   // Get all categories
   app.get('/categories', (req, res) => {
      if (categoriesStorage.isEmpty()) {
         return res.status(404).send('No categories added');
      }
      res.status(200).send(categoriesStorage.keys());
   });

   // Get all topic IDs of a category ID
   // Pinned topics appear first, followed by topics with most recent activity
   app.get('/categories/:categoryid/topics', (req, res) => {
      const categoryid: string = req.params.categoryid;

      const result = getCategoryOrTopicOrPost(res, categoryid);
      if (result.type === 'Ok') {
         const category: Category = result.value;
         const sortedTopics = sortTopicsByActivityAndPin(category);
         res.status(200).send(sortedTopics);
      }
   });

   // Get the specified topic
   app.get('/categories/:categoryid/topics/:topicid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      }
   });

   // Get the specified post
   app.get('/categories/:categoryid/topics/:topicid/posts/:postid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const postid: number = +req.params.postid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      }
   });

   // Get all moderators
   app.get('/moderators', (req, res) => {
      if (moderatorsStorage.isEmpty()) {
         res.status(404).send('No moderators added');
      } else {
         res.status(200).send(moderatorsStorage.values());
      }
   });

   // Get all admins
   app.get('/admins', (req, res) => {
      if (adminsStorage.isEmpty()) {
         res.status(404).send('No admins added');
      } else {
         res.status(200).send(adminsStorage.values());
      }
   });

   // Get all banned addresses
   app.get('/ban', (req, res) => {
      if (bannedAddressesStorage.isEmpty()) {
         res.status(404).send('No addresses banned');
      } else {
         res.status(200).send(bannedAddressesStorage.values());
      }
   });

   // POST requests

   // Create a category
   // Should only be accessible to admins
   app.post('/categories', (req, res) => {
      const validationError = validateCategoryInput(req.body);
      if (validationError) {
         return res.status(400).send(validationError);
      }

      const caller = ic.caller().toString();
      if (!checkIfAdmin(caller)) {
         return res.status(403).send('You are not an admin, and cannot add a category');
      }

      const category: Category = new Category(uuidv4(), req.body.name, caller);
      categoriesStorage.insert(category.id, category);
      res.status(201).send(category);
   });

   // Create a topic for a specific category
   app.post('/categories/:categoryid/topics', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const title: string = req.body.name;
      const message: string = req.body.message;

      const result = getCategoryOrTopicOrPost(res, categoryid);

      if (result.type === 'Ok') {
         const category: Category = result.value;
         const topic: Topic = new Topic(uuidv4(), title, message, category.id, ic.caller().toString());
         category.topics.set(topic.id, topic);
         acknowledgeTopicActivity(category, topic);
         res.status(201).send(topic);
      }
   });

   // Post on a specific topic
   app.post('/categories/:categoryid/topics/:topicid/posts', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const message: string = req.body.message;

      const categoryResult = getCategoryOrTopicOrPost(res, categoryid);
      const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid);

      if (categoryResult.type === 'Ok' && topicResult.type === 'Ok') {
         const category: Category = categoryResult.value;
         const topic: Topic = topicResult.value;
         const post: Message = new Message(uuidv4(), message, ic.caller().toString());
         topic.posts.push(post);
         acknowledgeTopicActivity(category, topic);
         res.status(201).send(post);
      }
   });

   // Like a topic
   app.post('/categories/:categoryid/topics/:topicid/likes', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid);
      if (result.type === 'Ok') {
         const topic: Topic = result.value;

         const isLiked: boolean = likeOrUnlikeMessage(topic, true);
         if (isLiked) {
            res.status(200).send('Topic liked');
         } else {
            res.status(400).send('Topic already liked');
         }
      }
   });

   // Like a post
   app.post('/categories/:categoryid/topics/:topicid/posts/:postid/likes', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const postid: number = +req.params.postid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid);
      if (result.type === 'Ok') {
         const post: Message = result.value;

         const isLiked: boolean = likeOrUnlikeMessage(post, true);
         if (isLiked) {
            res.status(200).send('Post liked');
         } else {
            res.status(400).send('Post already liked');
         }
      }
   });

   // PUT requests

   // Edit an existing topic
   app.put('/categories/:categoryid/topics/:topicid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const newMessage: string | null = req.body.newMessage;
      const newTitle: string | null = req.body.newTitle;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid);
      if (result.type === 'Ok') {
         const topic: Topic = result.value;
         if (!topic.closed) {
            if (!topic.messageDeleted) {
               if (newMessage !== null) {
                  editMessage(topic, newMessage);
               }
               if (newTitle !== null) {
                  editTitle(topic, newTitle);
               }
               res.status(200).send('Topic updated');
            } else {
               res.status(403).send('This topic has been deleted');
            }
         } else {
            res.status(403).send('This topic has been closed');
         }
      }
   });

   // Pin or unpin an existing topic
   app.put('/categories/:categoryid/topics/:topicid/pin', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const shouldPin: boolean = req.body.shouldPin;

      if (typeof shouldPin !== 'boolean') {
         return res.status(400).send('shouldPin was not provided or is not a boolean');
      }

      const caller: string = ic.caller().toString();

      if (checkIfModerator(caller) || checkIfAdmin(caller)) {
         const categoryResult = getCategoryOrTopicOrPost(res, categoryid);
         const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid);
         if (categoryResult.type === 'Ok' && topicResult.type === 'Ok') {
            const category: Category = categoryResult.value;
            const id: string = topicResult.value.id;

            const pinnedTopicsIndex = category.pinnedTopics.findIndex((element) => element === id);
            const isInPinnedTopics = pinnedTopicsIndex !== -1;

            if (isInPinnedTopics && !shouldPin) {
               category.pinnedTopics.splice(pinnedTopicsIndex, 1);
            } else if (!isInPinnedTopics && shouldPin) {
               category.pinnedTopics.push(id);
            }

            topicResult.value.pinned = shouldPin;
            res.status(200).send(`Topic ${shouldPin ? 'pinned' : 'unpinned'}`);
         }
      } else {
         res.status(403).send('You are not authorized to pin or unpin a topic');
      }
   });

   // Close or open an existing topic
   app.put('/categories/:categoryid/topics/:topicid/close', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const shouldClose: boolean = req.body.shouldClose;

      if (typeof shouldClose !== 'boolean') {
         return res.status(400).send('shouldClose was not provided or is not a boolean');
      }

      const caller: string = ic.caller().toString();

      if (checkIfModerator(caller) || checkIfAdmin(caller)) {
         const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid);
         if (topicResult.type === 'Ok') {
            const topic: Topic = topicResult.value;
            topic.closed = shouldClose;
            res.status(200).send(`Topic ${shouldClose ? 'closed' : 'reopened'}`);
         }
      } else {
         res.status(403).send('You are not authorized to close or reopen a topic');
      }
   });

   // Edit an existing post
   app.put('/categories/:categoryid/topics/:topicid/posts/:postid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const postid: number = +req.params.postid;
      const newMessage: string = req.body.newMessage;

      if (typeof newMessage !== 'string') {
         return res.status(400).send('newMessage was not provided or is not a string');
      }

      const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid);
      const postResult = getCategoryOrTopicOrPost(res, categoryid, topicid, postid);
      if (topicResult.type === 'Ok' && postResult.type === 'Ok') {
         const topic: Topic = topicResult.value;
         if (!topic.closed) {
            if (!topic.messageDeleted) {
               editMessage(postResult.value, newMessage);
               res.status(200).send('Post updated');
            } else {
               res.status(403).send('This post has been deleted');
            }
         } else {
            res.status(403).send('This post\'s topic has been closed');
         }
      }
   });

   // Add an address as a moderator
   app.put('/moderators/:address', (req, res) => {
      const address = req.params.address;
      const caller = ic.caller().toString();
      const result = addModerator(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   // Add an address as an admin
   app.put('/admins/:address', (req, res) => {
      const address = req.params.address;
      const caller = ic.caller().toString();
      const result = addAdmin(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   // Ban address
   app.put('/ban/:address', (req, res) => {
      const address = req.params.address;
      const caller = ic.caller().toString();
      const result = banAddress(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   // DELETE requests

   // Delete a category
   app.delete('/categories/:categoryid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const caller: string = ic.caller().toString();

      if (checkIfAdmin(caller)) {
         categoriesStorage.remove(categoryid);
         res.status(200).send('Category deleted');
      } else {
         res.status(403).send('You are not an admin, and cannot delete a category');
      }
   });

   // Delete a post
   app.delete('/categories/:categoryid/topics/:topicid/posts/:postid', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const postid: number = +req.params.postid;

      const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid);
      const postResult = getCategoryOrTopicOrPost(res, categoryid, topicid, postid);
      const caller: string = ic.caller().toString();

      if (topicResult.type === 'Ok' && postResult.type === 'Ok' && checkIfAuthorized(postResult.value.createdBy, caller)) {
         const post: Message = postResult.value;
         post.message = '';
         post.messageEditHistory.clear();
         post.messageDeleted = true;
         res.status(200).send('Post deleted');
      } else {
         res.status(403).send('You are not authorized to delete this post');
      }
   });

   // Remove an address as a moderator
   app.delete('/moderators/:address', (req, res) => {
      const address: string = req.params.address;
      const caller = ic.caller().toString();
      const result = removeModerator(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   // Remove an address as an admin
   app.delete('/admins/:address', (req, res) => {
      const address: string = req.params.address;
      const caller = ic.caller().toString();
      const result = removeAdmin(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   // Remove a like from a topic
   app.delete('/categories/:categoryid/topics/:topicid/likes', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid);
      if (result.type === 'Ok') {
         const topic: Topic = result.value;

         const isLiked: boolean = likeOrUnlikeMessage(topic, false);
         if (isLiked) {
            res.status(200).send('Like removed from topic');
         } else {
            res.status(400).send('Topic was not liked');
         }
      }
   });

   // Remove a like from a post
   app.delete('/categories/:categoryid/topics/:topicid/posts/:postid/likes', (req, res) => {
      const categoryid: string = req.params.categoryid;
      const topicid: string = req.params.topicid;
      const postid: number = +req.params.postid;

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid);
      if (result.type === 'Ok') {
         const post: Message = result.value;

         const isLiked: boolean = likeOrUnlikeMessage(post, false);
         if (isLiked) {
            res.status(200).send('Like removed from post');
         } else {
            res.status(400).send('Post was not liked');
         }
      }
   });

   // Unban an address
   app.delete('/ban/:address', (req, res) => {
      const address = req.params.address;
      const caller = ic.caller().toString();
      const result = unbanAddress(address, caller);
      if (result.type === 'Ok') {
         res.status(200).send(result.value);
      } else {
         res.status(403).send(result.error);
      }
   });

   return app.listen();
});

// Utility Functions

// Get a specific category/topic/post
function getCategoryOrTopicOrPost(res: any, categoryid: string, topicid?: string | "topics", postid?: number | "posts"): Result<any, undefined> {
   const categoryOpt = categoriesStorage.get(categoryid);

   if ("None" in categoryOpt) {
      res.status(404).send(`Category with id=${categoryid} not found`);
      return Err(undefined);
   } else if (topicid === undefined) {
      return Ok(categoryOpt.Some);
   } else {
      const topics = categoryOpt.Some.topics;
      if (topicid === "topics") {
         return Ok(topics);
      } else {
         const topic = topics.get(topicid);
         if (!topic) {
            res.status(404).send(`Topic with id=${topicid} not found`);
            return Err(undefined);
         } else if (postid === undefined) {
            return Ok(topic);
         } else {
            const post = topic.posts[postid];
            if (!post) {
               res.status(404).send(`Post with id=${postid} not found`);
               return Err(undefined);
            } else {
               return Ok(post);
            }
         }
      }
   }
}

// Acknowledge topic activity
function acknowledgeTopicActivity(category: Category, topic: Topic) {
   topic.mostRecentActivity = new Date();
   const mostRecentTopicIndex: number = category.mostRecentTopics.findIndex((element) => element === topic.id);
   if (mostRecentTopicIndex !== -1) {
      category.mostRecentTopics.splice(mostRecentTopicIndex, 1);
   }
   category.mostRecentTopics.unshift(topic.id);
}

// Sort topics by activity and pin status
function sortTopicsByActivityAndPin(category: Category): string[] {
   const sortedTopics = [...category.pinnedTopics, ...category.mostRecentTopics];
   const uniqueSortedTopics: string[] = [];
   sortedTopics.forEach((topicid) => {
      if (!uniqueSortedTopics.includes(topicid)) {
         uniqueSortedTopics.push(topicid);
      }
   });
   return uniqueSortedTopics;
}

// Like or unlike a message
function likeOrUnlikeMessage(message: Message, shouldLike: boolean): boolean {
   const caller = ic.caller().toString();
   const callerIndex = message.likes.findIndex((element) => element === caller);
   if (shouldLike) {
      if (callerIndex === -1) {
         message.likes.push(caller);
         return true;
      } else {
         return false;
      }
   } else {
      if (callerIndex !== -1) {
         message.likes.splice(callerIndex, 1);
         return true;
      } else {
         return false;
      }
   }
}

// Edit message
function editMessage(message: Message, newMessage: string) {
   message.messageEditHistory.set(new Date(), message.message);
   message.message = newMessage;
}

// Edit title
function editTitle(topic: Topic, newTitle: string) {
   topic.titleEditHistory.set(new Date(), topic.title);
   topic.title = newTitle;
}

// Validate the category input
function validateCategoryInput(category: any): string | null {
   const requiredFields = ['name'];
   for (const field of requiredFields) {
      if (!category[field] || typeof category[field] !== 'string' || category[field].trim() === '') {
         return `${field} is required and must be a non-empty string.`;
      }
   }
   return null;
}

// Checks if the caller is either the creator, an admin, or a moderator
function checkIfAuthorized(creatorAddress: string, caller: string): boolean {
   return checkIfAdmin(caller) || checkIfModerator(caller) || caller === creatorAddress;
}

// Administrative functions

// Validate the input to be the admin
function checkIfAdmin(address: string): boolean {
   return adminsStorage.values().some((admin) => admin.toUpperCase() === address.toUpperCase());
}

// Validate the input to be a moderator
function checkIfModerator(address: string): boolean {
   return moderatorsStorage.values().some((moderator) => moderator.toUpperCase() === address.toUpperCase());
}

// Check whether the address is banned
function checkIfBanned(address: string): boolean {
   return bannedAddressesStorage.values().some((banned) => banned === address);
}

// Add admin
function addAdmin(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err('You are not authorized to add an admin');
   }

   if (checkIfAdmin(address)) {
      return Err('Admin already added');
   }

   adminsStorage.insert(uuidv4(), address);
   return Ok(address);
}

// Add moderator
function addModerator(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err('You are not authorized to add a moderator');
   }

   if (checkIfModerator(address)) {
      return Err('Moderator already added');
   }

   moderatorsStorage.insert(uuidv4(), address);
   return Ok(address);
}

// Remove a moderator
function removeModerator(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err('You are not authorized to remove a moderator');
   }

   const moderatorEntry = Array.from(moderatorsStorage.entries()).find(([key, value]) => value === address);
   if (!moderatorEntry) {
      return Err('Moderator not found');
   }

   moderatorsStorage.remove(moderatorEntry[0]);
   return Ok(address);
}

// Remove an admin
function removeAdmin(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err('You are not authorized to remove an admin');
   }

   const adminEntry = Array.from(adminsStorage.entries()).find(([key, value]) => value === address);
   if (!adminEntry) {
      return Err('Admin not found');
   }

   adminsStorage.remove(adminEntry[0]);
   return Ok(address);
}

// Ban an address
function banAddress(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller) && !checkIfModerator(caller)) {
      return Err('You are not authorized to ban this address');
   }

   if (checkIfAdmin(address) || checkIfModerator(address)) {
      return Err('Cannot ban an admin or moderator');
   }

   if (checkIfBanned(address)) {
      return Err('Address is already banned');
   }

   bannedAddressesStorage.insert(uuidv4(), address);
   return Ok(address);
}

// Unban an address
function unbanAddress(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller) && !checkIfModerator(caller)) {
      return Err('You are not authorized to unban this address');
   }

   const bannedEntry = Array.from(bannedAddressesStorage.entries()).find(([key, value]) => value === address);
   if (!bannedEntry) {
      return Err('Address is not banned');
   }

   bannedAddressesStorage.remove(bannedEntry[0]);
   return Ok(address);
}
