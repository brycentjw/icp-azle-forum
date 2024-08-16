# icp_azle_fourm
This project is a decentralized learning platform built on the Internet Computer using Typescript and Azle framework. It allows users to create, read, delete, and edit topics and posts, with certain roles and permissions to ensure security and proper management.

The project leverages the capabilities of the Internet Computer to provide a decentralized environment for managing a forum, ensuring robust access control and user management.

### Detailed Functionality

- GET/categories
  - Get all categories
- GET/categories/:categoryid/topics
  - Get all topicids of a categoryid
  - Pinned topics should appear first, followed by topics with most recent activity
- GET/categories/:categoryid/topics/:topicid
  - Get the specified topic
- GET/categories:categoryid/topics/:topicid/posts/:postid
  - Get the specified post
- GET/moderators
  - Get all moderators
- GET/admins
  - Get all admins
- GET/ban
  - Get all banned addresses

- POST/categories
  - Create a category
  - Should only be accessible to admins
  - Body params: (name)
- POST/categories/:categoryid/topics
  - Create a topic for a specific category
  - Body params: (name, message)
- POST/categories/:categoryid/topics/:topicid/posts
  - Post on a specific topic
  - Body params: (message)
- POST/categories/:categoryid/topics/:topicid/likes
  - Like a topic
- POST/categories/:categoryid/topics/:topicid/posts/:postid/likes
  - Like a post

- PUT/categories/:categoryid/topics/:topicid
  - Edit an existing topic's message
  - Previous versions should show on edit history
  - This should only work if they created this topic
  - Body params: (newMessage?, newTitle?)
- PUT/categories/:categoryid/topics/:topicid/pin
  - Pin or unpin an existing topic
  - This should only be usable by a moderator or an admin
  - Body params: (shouldPin)
- PUT/categories/:categoryid/topics/:topicid/close
  - Close or open an existing topic
  - This should only be usable by a moderator or an admin
  - Body params: (shouldClose)
- PUT/categories/:categoryid/topics/:topicid/posts/:postid
  - Edit an existing post's message
  - Previous versions should show on edit history
  - This should only work if they created this post
  - Body params: (newMessage)
- PUT/moderators/:address
  - Add an address as a moderator
  - Should only be usable by an admin
- PUT/admins/:address
  - Add an address as an admin
  - Shouldn't be usable for now, just add it anyway
- PUT/ban/:address
  - Ban an address

- DELETE/categories/:categoryid
  - Delete a category
  - Should only be accessible to admins
- DELETE/categories/:categoryid/:topicid/:postid
  - Delete a post
  - Unless they are a moderator or admin, this should only work for a post they created
  - This will only remove the message and any edit history
- DELETE/moderators/:address
  - Remove an address as a moderator
- DELETE/admins/:address
  - Remove an address as an admin
- DELETE/categories/:categoryid/topics/:topicid/likes
  - Remove a like from a topic
- DELETE/categories/:categoryid/topics/:topicid/posts/:postid/likes
  - Remove a like from a post
- DELETE/ban/:address
  - Unban an address

## Prerequisities

1. Install `nvm`:
- `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash`

2. Switch to node v20:
- `nvm install 20`
- `nvm use 20`

3. Install build dependencies:
## For Ubuntu and WSL2
```
sudo apt-get install podman
```
## For macOS:
```
xcode-select --install
brew install podman
```

4. Install `dfx`
- `DFX_VERSION=0.16.1 sh -ci "$(curl -fsSL https://sdk.dfinity.org/install.sh)"`

5. Add `dfx` to PATH:
- `echo 'export PATH="$PATH:$HOME/bin"' >> "$HOME/.bashrc"`

6. Create a project structure:
- create `src` dir
- create `index.ts` in the `src` dir
- create `tsconfig.json` in the root directory with the next content
```
{
    "compilerOptions": {
        "allowSyntheticDefaultImports": true,
        "strictPropertyInitialization": false,
        "strict": true,
        "target": "ES2020",
        "moduleResolution": "node",
        "allowJs": true,
        "outDir": "HACK_BECAUSE_OF_ALLOW_JS"
    }
}
```
- create `dfx.json` with the next content
```
{
  "canisters": {
    "icp_azle_learning_platform": {
      "type": "custom",
      "main": "src/index.ts",
      "candid": "src/index.did",
      "candid_gen": "http",
      "build": "npx azle icp_azle_learning_platform",
      "wasm": ".azle/icp_azle_learning_platform/icp_azle_learning_platform.wasm",
      "gzip": true,
      "metadata": [
        {
            "name": "candid:service",
            "path": "src/index.did"
        },
        {
            "name": "cdk:name",
            "content": "azle"
        }
    ]
    }
  }
}

```
where `icp_azle_learning_platform` is the name of the canister. 

6. Create a `package.json` with the next content and run `npm i`:
```
{
  "name": "icp_azle_learning_platform",
  "version": "0.1.0",
  "description": "Internet Computer learning platform",
  "dependencies": {
    "@dfinity/agent": "^0.21.4",
    "@dfinity/candid": "^0.21.4",
    "azle": "^0.21.1",
    "express": "^4.18.2",
    "uuid": "^9.0.1"
  },
  "engines": {
    "node": "^20"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}

```

7. Run a local replica
- `dfx start --host 127.0.0.1:8000`

#### IMPORTANT NOTE 
If you make any changes to the `StableBTreeMap` structure like change datatypes for keys or values, changing size of the key or value, you need to restart `dfx` with the `--clean` flag. `StableBTreeMap` is immutable and any changes to it's configuration after it's been initialized are not supported.
- `dfx start --host 127.0.0.1:8000 --clean`

8. Deploy a canister
- `dfx deploy`
Also, if you are building an HTTP-based canister and would like your canister to autoreload on file changes (DO NOT deploy to mainnet with autoreload enabled):
```
AZLE_AUTORELOAD=true dfx deploy
```

9. Stop a local replica
- `dfx stop`

## Interaction with the canister

When a canister is deployed, `dfx deploy` produces a link to the Candid interface in the shell output.

Candid interface provides a simple UI where you can interact with functions in the canister.

On the other hand, you can interact with the canister using `dfx` via CLI:

### get canister id:
- `dfx canister id <CANISTER_NAME>`
Example:
- `dfx canister id icp_azle_learning_platform`
Response:
```
bkyz2-fmaaa-aaaaa-qaaaq-cai
```

Now, the URL of your canister should like this:
```
http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000
```

With this URL, you can interact with the canister using an HTTP client of your choice. We are going to use `curl`.

### create a course:
- `curl -X POST <CANISTER_URL>/<REQUEST_PATH> -H "Content-type: application/json" -d <PAYLOAD>`
Example: 
```
curl -X POST http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses  -H "Content-type: application/json" -d '{
    "title": "How to create a Typescript azle project",
    "content": "abc",
    "creatorName": "kishore",
    "attachmentURL": "url/",
    "category": "programming", 
    "keyword": "azle",
    "contact": "github.com/kishorevb70"
}'
```

### update a course:
- `curl -X PUT <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID> -H "Content-type: application/json" -d <PAYLOAD>`
Example (In this case we include a course id in the payload to identify the course we want to update): 
```
curl -X PUT http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/a97e22d2-bd33-4d55-a6ff-dd0e13468936  -H "Content-type: application/json" -d '{
    "title": "How to create a Typescript azle project",
    "content": "abc",
    "creatorName": "kishore",
    "attachmentURL": "url/",
    "category": "programming", 
    "keyword": "Azle",
    "contact": "github.com/kishorevb70"
}'
```

### get all courses:
- `curl <CANISTER_URL>/<REQUEST_PATH>`
Example:
- `curl http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses`

### get a course:
- `curl <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID>`
Example (here we only provide a course id):
- `curl http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/messages/d8326ec8-fe70-402e-8914-ca83f0f1055b`

### delete a course:
- `curl -X DELETE <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID>`
Example (here we only provide a course id):
```
curl -X DELETE http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/a97e22d2-bd33-4d55-a6ff-dd0e13468936
```

### filter courses
```
curl "http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/filter?filterType=OR&keyword=azle&category=programming&creatorName=kishore"
```