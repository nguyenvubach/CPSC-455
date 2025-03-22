import { WebSocketServer } from 'ws';
import {readFileSync, writeFileSync} from 'fs'
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './model/User.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { createServer } from 'https';
import {JSDOM} from 'jsdom'
import createDOMPurify from 'dompurify'

dotenv.config();

const PORT = 5000;

//Load SSL certificates
const server =  createServer({
  cert:readFileSync('../ssl/cert.pem'),
  key:readFileSync('../ssl/key.pem')
})

//Convert the URL to a file path
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// WebSocket server setup
// const wss = new WebSocketServer({ host: '0.0.0.0',port: PORT });
const wss = new WebSocketServer({server});



// Stored connected clients and chatrooms
const connectedClients = new Map(); // Map<username, WebSocket>
const activeUsers = new Set() //Set of active users
const chatHistory = new Map()  // store chat history

// Rate limit
const RATE_LIMIT = 10; // Max messages per second
const userMessageCounts = new Map();

// Heartbeat interval (in milliseconds)
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Innitialize DOMPurify
const  {window} = new JSDOM('')
const DOMPurify = createDOMPurify(window)

// Connect to MongoDB
mongoose
  .connect(process.env.dbURI)
  .then(() => console.log('DB Connected! and server running'))
  .catch((e) => console.log(e));

// Authenticate/Login user
async function authenticate(username, password) {
  const user = await User.findOne({ username });
  if (user && (await bcrypt.compare(password, user.password))) {
    return true;
  }
  return false;
}

// Register user
async function registerUser(username, password) {
  const newUser = new User({ username, password });
  await newUser.save();
  console.log('New user:', newUser);
}

// Broadcast active users to all clients
function broadcastActiveUsers() {
  const userList = Array.from(activeUsers);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      console.log('user_list',userList)
      client.send(JSON.stringify({type: 'user_list', users: userList}))
    }
  })
}

//Generate a unique chatroom name
function getChatroomName(user1, user2){
  const users = [user1, user2].sort(); //Sort usernames alphabetiaclly
  return users.join('-')
}

//Log chats to .txt file after disconnection
function logChatToFile(chatroomName, messages){
  const logFilePath = path.join(
    __dirname,
    'chat_logs',
    `${chatroomName}_${Date.now()}.txt`
  );
  const logContent = messages.map((msg)=> {
    if (msg.file) {
      return `${msg.from} sent a file at ${new Date().toISOString()}`
    } else {
      return `${msg.from}: ${msg.message} (${new Date().toISOString()})`
    }
  }).join('\n')
  writeFileSync(logFilePath, logContent, 'utf8');
  console.log(`Chat logged to ${logFilePath}}`)
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('New client connected');
  const clientIp =  req.socket.remoteAddress;
  console.log(`New client connected from IP: ${clientIp}`)

  // Set up heartbeat
  let heartbeatInterval;
  const setupHeartbeat = () => {
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, HEARTBEAT_INTERVAL);
  };

  // Start heartbeat
  setupHeartbeat();

  ws.on('message', async (message) => {
    let data;
    // Convert Buffer to string if necessary
    if (message instanceof Buffer) {
      data = JSON.parse(message.toString('utf8'));
    } else {
      data = JSON.parse(message);
    }
    console.log(`Received message: from ${clientIp}`, data);

    if (data.type === 'login') {
      if (await authenticate(data.username, data.password)) {
        connectedClients.set(data.username, ws);
        activeUsers.add(data.username)
        ws.send(
          JSON.stringify({ type: 'login_successfull', username: data.username })
        );
        broadcastActiveUsers()
      } else {
        ws.send(
          JSON.stringify({
            type: 'login_failed',
            message: 'Incorrect password/user does not exist',
          })
        );
      }
    } else if (data.type === 'register') {
      try {
        await registerUser(data.username, data.password);
        ws.send(JSON.stringify({ type: 'registration_successfull' }));
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: 'registration_failed',
            error: 'Username already exists',
          })
        );
      }
    } else if (data.type === 'switch_chat') {
      if (!connectedClients.has(data.username)) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'User not logged in' })
        );
        return;
      }
        const chatroomName = getChatroomName(data.username, data.recipient)
        const history = chatHistory.get(chatroomName) || [];
        ws.send(JSON.stringify({
          type: 'chat_history',
          chatroomName,
          messages:history,
        }))

    } else if (data.type === 'file') {
      if (!connectedClients.has(data.username)) {
        ws.send(JSON.stringify({type: 'error', message:'User not logged in'}));
        return
      }

      //Store the file in the chat history 
const chatroomName = getChatroomName(data.username, data.recipient);
const history = chatHistory.get(chatroomName) || [];
history.push({
  from: data.username,
  message: null,
  file: data.file,
  iv: data.iv,
  mimeType: data.mimeType
})
chatHistory.set(chatroomName, history);

// Send the file to the recipient
const reciepientWs = connectedClients.get(data.recipient)
if (reciepientWs) {
  JSON.stringify({
    type: 'file',
    file: data.file,
    iv: data.iv,
    mimeType: data.mimeType
  })
}
    }
    
    else if (data.type === 'message') {
      if (!connectedClients.has(data.username)) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'User not logged in' })
        );
        return;
      }

      // Rate limiting
      const count = userMessageCounts.get(data.username) || 0;
      if (count >= RATE_LIMIT) {
        ws.send(
          JSON.stringify({
            type: 'rate_limit_exceeded',
            message: 'Wait for 1 min',
          })
        );
      } else {
        userMessageCounts.set(data.username, count + 1);
        
        //Sanitize the HTML message
        const sanitizedMessage = DOMPurify.sanitize(data.message)

        //store message in chat history
        const chatroomName = getChatroomName(data.username, data.recipient)
        const history = chatHistory.get(chatroomName) || [];
        history.push({
          from: data.username, 
          message:sanitizedMessage,
          file: null,
        })
        chatHistory.set(chatroomName, history);

        //Send the message to the recipient
        const recipientWs = connectedClients.get(data.recipient)
        if (recipientWs){
          recipientWs.send(
            JSON.stringify({
              type: 'message',
              from: data.username,
              message: sanitizedMessage,
            })
          )
        }
        //send message back to the sender
        ws.send(
          JSON.stringify({
            type:'message',
            from: data.username,
            message: sanitizedMessage,
          })
        )
      }
    }
  });

  ws.on('close', () => {
    // Handle disconnection
    if (ws.username) {
      connectedClients.delete(ws.username)
      activeUsers.delete(ws.username);
      broadcastActiveUsers() //Broadcast updated user list
      console.log('chat history',chatHistory)
      //Log chats for all chatrooms involving the disconnected user
      chatHistory.forEach((messages, chatroomName) => {
        if (chatroomName.includes(ws.username)) {
          logChatToFile(chatroomName, messages); 
        }
      })
    }

    // Clear heartbeat interval
    clearInterval(heartbeatInterval);
    console.log('Client disconnected')
  });
});


server.listen(PORT, ()=> {
  console.log(`WebSocket server running wss://localhost:${PORT}`)
})
