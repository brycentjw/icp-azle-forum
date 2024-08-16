import { v4 as uuidv4 } from 'uuid'
import { Server, StableBTreeMap, ic } from 'azle'
import express from 'express'

/**
 * `messagesStorage` - it's a key-value datastructure that is used to store messages.
 * {@link StableBTreeMap} is a self-balancing tree that acts as a durable data storage that keeps data across canister upgrades.
 * For the sake of this contract we've chosen {@link StableBTreeMap} as a storage for the next reasons:
 * - `insert`, `get` and `remove` operations have a constant time complexity - O(1)
 * - data stored in the map survives canister upgrades unlike using HashMap where data is stored in the heap and it's lost after the canister is upgraded
 *
 * Brakedown of the `StableBTreeMap(string, Message)` datastructure:
 * - the key of map is a `messageId`
 * - the value in this map is a message itself `Message` that is related to a given key (`messageId`)
 *
 * Constructor values:
 * 1) 0 - memory id where to initialize a map.
 */

/**
 This type represents a message that can be listed on a board.
 */

/**
GET/categories
   Get all categories
GET/categories/:categoryid/topics
   Get all topicids of a categoryid
   Pinned topics should appear first, followed by topics with most recent activity
GET/categories/:categoryid/topics/:topicid
   Get the specified topic
GET/categories:categoryid/topics/:topicid/posts/:postid
   Get the specified post
GET/moderators
   Get all moderators
GET/admins
   Get all admins
GET/ban
   Get all banned addresses

POST/categories
   Create a category
   Should only be accessible to admins
   Body params: (name)
POST/categories/:categoryid/topics
   Create a topic for a specific category
   Body params: (name, message)
POST/categories/:categoryid/topics/:topicid/posts
   Post on a specific topic
   Body params: (message)
POST/categories/:categoryid/topics/:topicid/likes
   Like a topic
POST/categories/:categoryid/topics/:topicid/posts/:postid/likes
   Like a post

PUT/categories/:categoryid/topics/:topicid
   Edit an existing topic's message
   Previous versions should show on edit history
   This should only work if they created this topic
   Body params: (newMessage?, newTitle?)
PUT/categories/:categoryid/topics/:topicid/pin
   Pin or unpin an existing topic
   This should only be usable by a moderator or an admin
   Body params: (shouldPin)
PUT/categories/:categoryid/topics/:topicid/close
   Close or open an existing topic
   This should only be usable by a moderator or an admin
   Body params: (shouldClose)
PUT/categories/:categoryid/topics/:topicid/posts/:postid
   Edit an existing post's message
   Previous versions should show on edit history
   This should only work if they created this post
   Body params: (newMessage)
PUT/moderators/:address
   Add an address as a moderator
   Should only be usable by an admin
PUT/admins/:address
   Add an address as an admin
   Shouldn't be usable for now, just add it anyway
PUT/ban/:address
   Ban an address

DELETE/categories/:categoryid
   Delete a category
   Should only be accessible to admins
DELETE/categories/:categoryid/:topicid/:postid
   Delete a post
   Unless they are a moderator or admin, this should only work for a post they created
   This will only remove the message and any edit history
DELETE/moderators/:address
   Remove an address as a moderator
DELETE/admins/:address
   Remove an address as an admin
DELETE/categories/:categoryid/topics/:topicid/likes
   Remove a like from a topic
DELETE/categories/:categoryid/topics/:topicid/posts/:postid/likes
   Remove a like from a post
DELETE/ban/:address
   Unban an address
*/

class Message {
   id: string
   message: string
   messageDeleted: boolean
   createdBy: string
   createdAt: Date
   likes: string[]
   messageEditHistory: Map<Date, string>

   constructor(id: string, message: string, createdBy: string) {
      this.id = id
      this.message = message
      this.messageDeleted = false
      this.createdBy = createdBy
      this.createdAt = new Date()
      this.messageEditHistory = new Map<Date, string>
   }
}

class Topic extends Message {
   title: string
   posts: Message[]
   pinned: boolean
   closed: boolean
   categoryid: string
   titleEditHistory: Map<Date, string>
   mostRecentActivity: Date

   constructor(id: string, title: string, message: string, categoryid: string, createdBy: string) {
      super(id, message, createdBy)
      this.title = title
      this.posts = []
      this.pinned = false
      this.closed = false
      this.categoryid = categoryid
      this.mostRecentActivity = new Date()
      this.titleEditHistory = new Map<Date, string>
   }
}

class Category {
   id: string
   name: string
   topics: Map<string, Topic>
   pinnedTopics: string[]
   mostRecentTopics: string[]
   createdAt: Date
   createdBy: string

   constructor(id: string, name: string, createdBy: string) {
      this.id = id
      this.name = name
      this.topics = new Map<string, Topic>
      this.pinnedTopics = []
      this.createdAt = new Date()
      this.createdBy = createdBy
   }
}

// Custom type for error handling from functions
type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E }

function Ok<T>(value: T): Result<T, never> {
   return { type: 'Ok', value }
}

function Err<E>(error: E): Result<never, E> {
   return { type: 'Err', error }
}

// Storing important variables in persistent memory using stableBTreeMap
const categoriesStorage = StableBTreeMap<string, Category>(0)
const bannedAddressesStorage = StableBTreeMap<string, string>(1)
const moderatorsStorage = StableBTreeMap<string, string>(2)
const adminsStorage = StableBTreeMap<string, string>(3)

export default Server(() => {
   const app = express()
   app.use(express.json())

   // GET Requests

   // Get all categories
   app.get("/categories", (req, res) => {
      if (categoriesStorage.isEmpty()) {
         return res.status(500).send("No categories added")
      }
      res.status(200).send(categoriesStorage.keys())
   })

   // Get all topicids of a categoryid
   // Pinned topics appear first, followed by topics with most recent activity
   app.get("/categories/:categoryid/topics", (req, res) => {
      const categoryid: string = req.params.categoryid

      const result = getCategoryOrTopicOrPost(res, categoryid)
      if (result.type === "Ok") {
         const category: Category = result.value
         const pinnedTopics: string[] = category.pinnedTopics
         const mostRecentTopics: string[] = category.mostRecentTopics

         const sortedTopics: string[] = pinnedTopics.concat(mostRecentTopics)
         const uniqueSortedTopics: string[] = []
         sortedTopics.forEach(function (topicid) {
            if (uniqueSortedTopics.findIndex((element) => element === topicid) === -1) {
               uniqueSortedTopics.push(topicid)
            }
         })

         res.status(200).send(uniqueSortedTopics)
      }
   })

   // Get the specified topic
   app.get("/categories/:categoryid/topics/:topicid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid)
      if (result.type === "Ok") {
         res.status(200).send(result.value)
      }
   })

   // Get the specified post
   app.get("/categories/:categoryid/topics/:topicid/posts/:postid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const postid: number = +req.params.postid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid)
      if (result.type === "Ok") {
         res.status(200).send(result.value)
      }
   })

   // Get all moderators
   app.get("/moderators", (req, res) => {
      if (moderatorsStorage.isEmpty()) {
         res.status(500).send(`No moderators added`)
      } else {
         res.status(200).send(moderatorsStorage.values())
      }
   })

   // Get all admins
   app.get("/admins", (req, res) => {
      if (adminsStorage.isEmpty()) {
         res.status(500).send(`No admins added`)
      } else {
         res.status(200).send(adminsStorage.values())
      }
   })

   // Get all banned addresses
   app.get("/ban", (req, res) => {
      if (adminsStorage.isEmpty()) {
         res.status(500).send(`No addresses banned`)
      } else {
         res.status(200).send(adminsStorage.values())
      }
   })

   // POST requests

   // Create a category
   // Should only be accessible to admins
   app.post("/categories", (req, res) => {
      // Validate that the request contains all the required fields
      const validationError = validateCategoryInput(req.body)
      if (validationError) {
         return res.status(400).send(validationError)
      }

      // Check if the address is an admin
      const caller = ic.caller().toString()
      if (checkIfAdmin(caller)) {
         res.status(403).send(`You are not an admin, and cannot add a category`)
      }

      // Create new instance of course
      // This syntax will eliminate any additional fields provided in the request body
      const category: Category = new Category(uuidv4(), req.body.name, ic.caller().toString())

      // Add the course into persistent memory
      categoriesStorage.insert(category.id, category)
      res.status(200).send(category)
   })

   // Create a topic for a specific category
   app.post("/categories/:categoryid/topics", (req, res) => {
      const categoryid: string = req.params.categoryid
      const title: string = req.body.name
      const message: string = req.body.message

      const result = getCategoryOrTopicOrPost(res, categoryid)

      if (result.type === "Ok") {
         const category: Category = result.value
         const topic: Topic = new Topic(uuidv4(), title, message, category.id, ic.caller().toString())
         category.topics.set(topic.id, topic)
         acknowledgeTopicActivity(category, topic)
         res.status(200)
      }
   })

   // Post on a specific topic
   app.post("/categories/:categoryid/topics/:topicid/posts", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const message: string = req.body.message

      const categoryResult = getCategoryOrTopicOrPost(res, categoryid)
      const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid)

      if (categoryResult.type === "Ok" && topicResult.type === "Ok") {
         const category: Category = categoryResult.value
         const topic: Topic = topicResult.value
         const post: Message = new Message(uuidv4(), message, ic.caller().toString())
         topic.posts.push(post)
         acknowledgeTopicActivity(category, topic)
         res.status(200)
      }
   })

   // Like a topic
   app.post("/categories/:categoryid/topics/:topicid/likes", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid)
      if (result.type === "Ok") {
         const topic: Topic = result.value

         const isLiked: boolean = likeOrUnlikeMessage(topic, true)
         if (isLiked === true) {
            res.status(200)
         } else {
            res.status(500).send(`Topic already liked`)
         }
      }
   })

   // Like a post
   app.post("/categories/:categoryid/topics/:topicid/posts/:postid/likes", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const postid: number = +req.params.postid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid)
      if (result.type === "Ok") {
         const topic: Topic = result.value

         const isLiked: boolean = likeOrUnlikeMessage(topic, true)
         if (isLiked === true) {
            res.status(200)
         } else {
            res.status(500).send(`Post already liked`)
         }
      }
   })

   // PUT requests

   // Edit an existing topic
   // Previous versions should show on edit history
   // This should only work if they created this topic
   app.put("/categories/:categoryid/topics/:topicid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const newMessage: string | null = req.body.newMessage
      const newTitle: string | null = req.body.newTitle

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid)
      if (result.type === "Ok") {
         const topic: Topic = result.value
         if (!topic.closed) {
            if (!topic.messageDeleted) {
               if (newMessage !== null) {
                  editMessage(result.value, newMessage)
               }
               if (newTitle !== null) {
                  editTitle(result.value, newTitle)
               }
               res.status(200)
            } else {
               res.status(403).send("This topic has been deleted")
            }
         } else {
            res.status(403).send("This topic has been closed")
         }
      }
   })

   // Pin or unpin an existing topic
   // This should only be usable by a moderator or an admin
   app.put("/categories/:categoryid/topics/:topicid/pin", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const shouldPin: boolean = req.body.shouldPin

      if (typeof shouldPin !== "boolean") {
         res.status(400).send("shouldPin was not given in the body")
      } else {
         const caller: string = ic.caller().toString()

         if (checkIfModerator(caller) === true || checkIfAdmin(caller) === true) {
            const categoryResult = getCategoryOrTopicOrPost(res, categoryid)
            const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid)
            if (categoryResult.type === "Ok" && topicResult.type === "Ok") {
               const category: Category = categoryResult.value
               const id: string = topicResult.value.id

               const pinnedTopicsIndex = category.pinnedTopics.findIndex((element) => element === id)
               const isInPinnedTopics = pinnedTopicsIndex !== -1

               if (isInPinnedTopics === true && !shouldPin) {
                  category.pinnedTopics.splice(pinnedTopicsIndex, pinnedTopicsIndex)
               } else if (isInPinnedTopics === false && shouldPin) {
                  category.pinnedTopics.push(id)
               }

               topicResult.value.pinned = shouldPin
            }
         } else {
            res.status(403).send("You are not authorized to pin or unpin a topic")
         }
      }
   })

   // Close or open an existing topic
   // This should only be usable by a moderator or an admin
   app.put("/categories/:categoryid/topics/:topicid/close", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const shouldClose: boolean = req.body.shouldClose

      if (typeof shouldClose !== "boolean") {
         res.status(400).send("shouldCLose was not given in the body")
      } else {
         const caller: string = ic.caller().toString()

         if (checkIfModerator(caller) === true || checkIfAdmin(caller) === true) {
            const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid)
            if (topicResult.type === "Ok") {
               const topic: Topic = topicResult.value
               topic.closed = shouldClose
            }
         } else {
            res.status(400).send("You are not authorized to close or reopen a topic")
         }
      }
   })

   // Edit an existing post
   // Previous versions should show on edit history
   // This should only work if they created this post
   app.put("/categories/:categoryid/topics/:topicid/posts/:postid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const postid: number = +req.params.postid
      const newMessage: string = req.body.newMessage

      if (typeof newMessage !== "string") {
         res.status(400).send("newMessage was not given in the body")
      } else {
         const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid)
         const postResult = getCategoryOrTopicOrPost(res, categoryid, topicid, postid)
         if (topicResult.type === "Ok" && postResult.type === "Ok") {
            const topic: Topic = topicResult.value
            if (!topic.closed) {
               if (!topic.messageDeleted) {
                  editMessage(postResult.value, newMessage)
                  res.status(200)
               } else {
                  res.status(403).send("This post has been deleted")
               }
            } else {
               res.status(403).send("This post's topic has been closed")
            }
         }
      }
   })

   // Add an address as a moderator
   // Should only be usable by an admin
   app.put("/moderators/:address", (req, res) => {
      const address = req.params.address
      let caller = ic.caller().toString()
      // Only an admin can add a moderator
      const result = addModerator(address, caller)
      if (result.type === 'Ok') {
         res.status(200).send(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   // Add an address as an admin
   app.put("/admins/:address", (req, res) => {
      const address = req.params.address
      let caller = ic.caller().toString()
      // Only an admin can add an admin
      const result = addAdmin(address, caller)
      if (result.type === 'Ok') {
         res.status(200).send(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   // Ban address
   app.put("/ban/:address", (req, res) => {
      const address = req.params.address
      const caller = ic.caller().toString()
      // Only the admin or a moderator can access
      const result = banAddress(address, caller)
      if (result.type === 'Ok') {
         res.json(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   // DELETE requests

   // Delete a category
   // Should only be accessible to admins
   app.delete("/categories/:categoryid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const caller: string = ic.caller().toString()

      const result = checkIfAdmin(caller)
      if (result === true) {
         categoriesStorage.remove(categoryid)
      } else {
         res.status(403).send(`You are not an admin, and cannot delete a category`)
      }
   })

   // Delete a post
   // Unless they are a moderator or admin, this should only work for a post they created
   // This will only remove the message and any edit history
   app.delete("/categories/:categoryid/:topicid/:postid", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const postid: number = +req.params.postid

      const topicResult = getCategoryOrTopicOrPost(res, categoryid, topicid)
      const postResult = getCategoryOrTopicOrPost(res, categoryid, topicid, postid)

      const caller: string = ic.caller().toString()

      if (topicResult.type === "Ok" && postResult.type === "Ok" && checkIfAuthorized(postResult.value.createdBy, caller) === true) {
         const post: Message = postResult.value

         post.message = ""
         post.messageEditHistory.clear()
         post.messageDeleted = true

         res.status(200)
      } else {
         res.status(403).send(`You are not a moderator, an admin or the creator of this post, and cannot delete it`)
      }
   })

   // Remove an address as a moderator
   app.delete("/moderators/:address", (req, res) => {
      const address: string = req.params.address
      const caller = ic.caller().toString()
      // Only the admin can remove a moderator
      const result = removeModerator(address, caller)
      if (result.type === 'Ok') {
         res.status(200).send(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   // Remove an address as an admin
   app.delete("/admins/:address", (req, res) => {
      const address: string = req.params.address
      const caller = ic.caller().toString()
      // Only the admin can remove a moderator
      const result = removeAdmin(address, caller)
      if (result.type === 'Ok') {
         res.status(200).send(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   // Remove a like from a topic
   app.post("/categories/:categoryid/topics/:topicid/likes", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid)
      if (result.type === "Ok") {
         const topic: Topic = result.value

         const isLiked: boolean = likeOrUnlikeMessage(topic, false)
         if (isLiked === true) {
            res.status(200)
         } else {
            res.status(500).send(`Topic already unliked`)
         }
      }
   })

   // Remove a like from a post
   app.post("/categories/:categoryid/topics/:topicid/posts/:postid/likes", (req, res) => {
      const categoryid: string = req.params.categoryid
      const topicid: string = req.params.topicid
      const postid: number = +req.params.postid

      const result = getCategoryOrTopicOrPost(res, categoryid, topicid, postid)
      if (result.type === "Ok") {
         const topic: Topic = result.value

         const isLiked: boolean = likeOrUnlikeMessage(topic, false)
         if (isLiked === true) {
            res.status(200)
         } else {
            res.status(500).send(`Post already unliked`)
         }
      }
   })

   // Unban an address
   app.delete("/ban/:address", (req, res) => {
      const address = req.params.address
      const caller = ic.caller().toString()
      // Only the admin or a moderator can access
      const result = unbanAddress(address, caller)
      if (result.type === 'Ok') {
         res.json(result.value)
      } else {
         res.status(400).send(result.error)
      }
   })

   return app.listen()
})

// Get a specific category/topic/post
function getCategoryOrTopicOrPost(res: any, categoryid: string, topicid?: string | "topics", postid?: number | "posts"): Result<any, undefined> {
   if (topicid === null) {
      res.status(422).send(`The topicid (id=${topicid}) could not be turned into a number`)
      return Err(undefined)
   }
   if (postid === null) {
      res.status(422).send(`The postid (id=${postid}) could not be turned into a number`)
      return Err(undefined)
   }

   const categoryOpt = categoriesStorage.get(categoryid)

   if ("None" in categoryOpt) {
      res.status(404).send(`The category with id=${categoryid} not found`)
   } else if (topicid === undefined) {
      return Ok(categoryOpt.Some)
   } else {
      const topics: Map<string, Topic> | null = categoryOpt.Some.topics
      if (topics === null) {
         res.status(500).send(`No topics added`)
      } else if (topicid === "topics") {
         return Ok(topics)
      } else {
         const topic: Topic | undefined = topics.get(topicid)
         if (topic === undefined) {
            res.status(404).send(`The topicd with id=${topicid} not found`)
         } else if (postid === undefined) {
            return Ok(topic)
         } else {
            if (topic.posts === null) {
               res.status(500).send(`No posts added`)
            } else if (postid === "posts") {
               return Ok(topic.posts)
            } else {
               const post: Message | null = topic.posts[postid]
               if (post === null) {
                  res.status(404).send(`The postid with id=${postid} not found`)
               } else {
                  return Ok(post)
               }
            }
         }
      }
   }
   return Err(undefined)
}

// Acknowledge topic activity
function acknowledgeTopicActivity(category: Category, topic: Topic) {
   topic.mostRecentActivity = new Date()
   const mostRecentTopicIndex: number = category.mostRecentTopics.findIndex((element) => element === topic.id)
   if (mostRecentTopicIndex !== -1) {
      category.mostRecentTopics.splice(mostRecentTopicIndex, mostRecentTopicIndex)
   }
   category.mostRecentTopics.unshift(topic.id)
}

// Like or unlike a message
function likeOrUnlikeMessage(message: Message, shouldLike: boolean): boolean {
   const caller = ic.caller().toString()
   const callerIndex = message.likes.findIndex((element) => element === caller)
   if (shouldLike === true) {
      if (callerIndex === undefined) {
         message.likes.push(ic.caller().toString())
         return true
      } else {
         return false
      }
   } else {
      if (callerIndex === undefined) {
         return false
      } else {
         message.likes.splice(callerIndex, callerIndex)
         return true
      }
   }
}

// Edit message
function editMessage(message: Message, newMessage: string) {
   const messageEditHistory: Map<Date, string> = message.messageEditHistory
   messageEditHistory.set(new Date, message.message)
   message.message = newMessage
}

function editTitle(topic: Topic, newTitle: string) {
   const titleEditHistory: Map<Date, string> = topic.titleEditHistory
   titleEditHistory.set(new Date, topic.title)
   topic.title = newTitle
}

// Validate the course input
function validateCategoryInput(course: any): string | null {
   const requiredFields = [
      'name'
   ]

   for (const field of requiredFields) {
      if (!course[field] || typeof course[field] !== 'string' || course[field].trim() === '') {
         return `${field} is required and must be a non-empty string.`
      }
   }

   return null
}

// Checks if the caller is either the creator or the admin or a moderator
function checkIfAuthorized(creatorAddress: string, caller: string): boolean {
   if (checkIfAdmin(caller) || checkIfModerator(caller) || caller === creatorAddress) {
      return true
   }
   return false
}

// Administrative functions

// Validate the input to be the admin
function checkIfAdmin(address: string): boolean {
   if (adminsStorage.isEmpty()) {
      return false
   }
   const admins = adminsStorage.values()
   for (const value of admins) {
      if (value.toUpperCase() === address.toUpperCase()) {
         return true
      }
   }
   return false
}

// Validate the input to be a moderator
function checkIfModerator(address: string): boolean {
   if (moderatorsStorage.isEmpty()) {
      return false
   }
   const moderators = moderatorsStorage.values()
   for (const value of moderators) {
      if (value.toUpperCase() === address.toUpperCase()) {
         return true
      }
   }
   return false
}

// Check whether the address is banned
function checkIfBanned(address: string): boolean {
   if (bannedAddressesStorage.isEmpty()) {
      return false
   }
   const bannedAddresses = bannedAddressesStorage.values()
   for (const value of bannedAddresses) {
      if (value === address) {
         return true
      }
   }
   return false
}

// Add admin
function addAdmin(address: string, caller: string): Result<string, string> {
   // Checks if the caller is an admin
   // TODO: probably change this? might just leave it here as intentional design
   if (!checkIfAdmin(caller)) {
      return Err("not authorized")
   }

   if (adminsStorage.isEmpty()) {
      adminsStorage.insert(uuidv4(), address)
      return Ok(address)
   }

   // Returns array of tuple containing key and values
   let moderators = moderatorsStorage.values()

   // Check if admin already present
   for (const value of moderators) {
      if (value === address) {
         return Err("moderator already added")
      }
   }

   // Add admin into storage
   moderatorsStorage.insert(uuidv4(), address)
   return Ok(address)
}

// Add moderator
function addModerator(address: string, caller: string): Result<string, string> {
   // Checks if the caller is an admin
   if (!checkIfAdmin(caller)) {
      return Err("not authorized")
   }

   if (moderatorsStorage.isEmpty()) {
      moderatorsStorage.insert(uuidv4(), address)
      return Ok(address)
   }

   // Returns array of tuple containing key and values
   let moderators = moderatorsStorage.values()

   // Check if moderator already present
   for (const value of moderators) {
      if (value === address) {
         return Err("moderator already added")
      }
   }

   // Add moderator into storage
   moderatorsStorage.insert(uuidv4(), address)
   return Ok(address)
}

// Only the admin can remove a moderator
function removeModerator(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err("You are not authorized to remove a moderator")
   }

   if (moderatorsStorage.isEmpty()) {
      return Err("Moderators empty")
   }

   let moderators = moderatorsStorage.items()
   let isModerator: boolean = false

   // Obtain the id of the address
   let id: string = ""
   for (const [key, value] of moderators) {
      if (value === address) {
         isModerator = true
         id = key
         break
      }
   }

   if (!checkIfModerator) {
      return Err("Provided address is not a moderator")
   }

   // Remove the moderator
   moderatorsStorage.remove(id)
   return Ok(address)
}

// Only an admin can remove an admin
function removeAdmin(address: string, caller: string): Result<string, string> {
   if (!checkIfAdmin(caller)) {
      return Err("You are not authorized to remove an admin")
   }

   if (adminsStorage.isEmpty()) {
      return Err("Admins empty")
   }

   let admins = adminsStorage.items()
   let isAdmin: boolean = false

   // Obtain the id of the address
   let id: string = ""
   for (const [key, value] of admins) {
      if (value === address) {
         isAdmin = true
         id = key
         break
      }
   }

   if (!isAdmin) {
      return Err("Provided address is not an admin")
   }

   // Remove the moderator
   adminsStorage.remove(id)
   return Ok(address)
}

/* 
Either the admin or a moderator can access
Cannot ban the admin or a moderator
*/
function banAddress(address: string, caller: string): Result<string, string> {
   if (
      // Check whether the address is either the admin or a moderator
      (!checkIfAdmin(caller) && !checkIfModerator(caller)) ||

      // Check if the address to be banned is a moderator or admin
      (checkIfAdmin(address) || checkIfModerator(address))
   ) {
      return Err("You are not authorized to ban this address")
   }

   bannedAddressesStorage.insert(uuidv4(), address)
   return Ok(address)
}

// Remove the address from the banned list
// Either the admin or a moderator can access
function unbanAddress(address: string, caller: string): Result<string, string> {
   if (
      !checkIfAdmin(caller) || !checkIfModerator(caller)
   ) {
      return Err("you are not authorized to unban this address")
   }

   if (bannedAddressesStorage.isEmpty()) {
      return Err("No addresses banned")
   }

   const bannedAddresses = bannedAddressesStorage.items()

   // Check if the address is banned  
   if (!checkIfBanned(address)) {
      return Err("Address is not banned")
   }

   let id: string = ""

   // Obtain the id of the banned address
   for (const [key, value] of bannedAddresses) {
      if (value === address) {
         id = key
      }
   }

   // Remove address from the list of banned addresses
   bannedAddressesStorage.remove(id)
   return Ok(address)
}

function getCurrentDate() {
   const timestamp = new Number(ic.time())
   return new Date(timestamp.valueOf() / 1000_000)
}