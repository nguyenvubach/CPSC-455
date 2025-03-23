import { createServer } from 'https';
import { existsSync, mkdir, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './model/User.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

dotenv.config();

const PORT = 5000;

// Load SSL certificates
const server = createServer({
  cert: readFileSync('../ssl/certificate.pem'), // Replace with your certificate path
  key: readFileSync('../ssl/private_key.pem'), // Replace with your private key path
});

// Convert the file URL to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WebSocket server setup
const wss = new WebSocketServer({ server });

// Stored connected clients
const connectedClients = new Map(); // Map<username, WebSocket>
const activeUsers = new Set(); // Set of active users
const chatHistory = new Map(); // Map<chatroomName, Array<{ from: string, message: string, file: Uint8Array | null }>>
const failedLoginAttempts = new Map(); // Map<username, { attempts: number, lastAttempt: number }>
const publicKeys = new Map()

const MAX_FAILED_ATTEMPTS = 5; // Maximum allowed failed attempts
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Rate limit
const RATE_LIMIT = 5; // Max messages per second
const userMessageCounts = new Map();

// Heartbeat interval (in milliseconds)
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Initialize DOMPurify
const { window } = new JSDOM('');
const DOMPurify = createDOMPurify(window);

// Connect to MongoDB
mongoose
  .connect(process.env.dbURI)
  .then(() => console.log('DB Connected!'))
  .catch((e) => console.log(e));

// Authenticate/Login user
async function authenticate(username, password) {
  const now = Date.now();
  const userAttempts = failedLoginAttempts.get(username) || {
    attempts: 0,
    lastAttempt: 0,
  };

  // Check if the user is currently locked out
  if (
    userAttempts.attempts >= MAX_FAILED_ATTEMPTS &&
    now - userAttempts.lastAttempt < LOCKOUT_DURATION
  ) {
    return {
      success: false,
      message: 'Account temporarily locked. Please try again later.',
    };
  }

  const user = await User.findOne({ username });
  if (user && (await bcrypt.compare(password, user.password))) {
    // Reset failed attempts on successful login
    failedLoginAttempts.delete(username);
    return { success: true };
  } else {
    // Increment failed attempts
    userAttempts.attempts += 1;
    userAttempts.lastAttempt = now;
    failedLoginAttempts.set(username, userAttempts);
    return {
      success: false,
      message: 'Incorrect password/user does not exist',
    };
  }
}
// Register user
async function registerUser(username, password) {
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.message);
  }
  const newUser = new User({ username, password });
  await newUser.save();
  console.log('New user:', newUser);
}

// Broadcast active users to all clients
function broadcastActiveUsers() {
  const userList = Array.from(activeUsers);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: 'user_list', users: userList }));
    }
  });
}

// Function to generate a unique chatroom name
function getChatroomName(user1, user2) {
  const users = [user1, user2].sort(); // Sort usernames alphabetically
  return users.join('-'); // Join with a hyphen
}

// Function to log chats to a .txt file
 function logChatToFile(chatroomName, messages) {
  const logDirectory = path.join(__dirname, 'chat_logs');
  if (!existsSync(logDirectory)) {
    mkdirSync(logDirectory, {recursive: true})
  }
  const logFilePath = path.join(
    __dirname,
    'chat_logs',
    `${chatroomName}_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`
  );
  const logContent = messages
    .map((msg) => {
      if (msg.file) {
        return `${msg.from} sent a file at ${new Date().toISOString()}`;
      } else {
        return `${msg.from}: ${msg.message} (${new Date().toISOString()})`;
      }
    })
    .join('\n');

  writeFileSync(logFilePath, logContent, 'utf8');
  console.log(`Chat logged to ${logFilePath}`);
}

//Validate password
function validatePassword(password) {
  const minLength = 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*]/.test(password);

  if (password.length < minLength) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters long.',
    };
  }
  if (!hasUppercase) {
    return {
      valid: false,
      message: 'Password must contain at least one uppercase letter.',
    };
  }
  if (!hasLowercase) {
    return {
      valid: false,
      message: 'Password must contain at least one lowercase letter.',
    };
  }
  if (!hasNumber) {
    return {
      valid: false,
      message: 'Password must contain at least one number.',
    };
  }
  if (!hasSpecialChar) {
    return {
      valid: false,
      message:
        'Password must contain at least one special character (!@#$%^&*).',
    };
  }

  return { valid: true };
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('New client connected');
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from IP: ${clientIp}`);

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
    if (message instanceof Buffer) {
      data = JSON.parse(message.toString('utf8'));
    } else {
      data = JSON.parse(message);
    }
    console.log(`Received message from ${clientIp}:`, data);

    if (data.type === 'login') {
      const authResult = await authenticate(data.username, data.password);
      if (authResult.success) {
        connectedClients.set(data.username, ws);
        activeUsers.add(data.username);
        ws.username = data.username
        ws.send(
          JSON.stringify({ type: 'login_successfull', username: data.username })
        );
        broadcastActiveUsers(); // Broadcast updated user list
      } else {
        ws.send(
          JSON.stringify({
            type: 'login_failed',
            message: authResult.message,
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
            error: error.message,
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

      const chatroomName = getChatroomName(data.username, data.recipient);
      const history = chatHistory.get(chatroomName) || [];
      ws.send(
        JSON.stringify({
          type: 'chat_history',
          chatroomName,
          messages: history,
        })
      );
    } else if (data.type === 'file') {
      if (!connectedClients.has(data.username)) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'User not logged in' })
        );
        return;
      }

      // Store the file in chat history
      const chatroomName = getChatroomName(data.username, data.recipient);
      const history = chatHistory.get(chatroomName) || [];
      history.push({
        from: data.username,
        message: null,
        file: data.file,
        iv: data.iv,
        mimeType: data.mimeType, // Include the MIME type
      });
      chatHistory.set(chatroomName, history);

      // Send the file to the recipient
      const recipientWs = connectedClients.get(data.recipient);
      if (recipientWs) {
        recipientWs.send(
          JSON.stringify({
            type: 'file',
            from: data.username,
            iv: data.iv,
            file: data.file,
            mimeType: data.mimeType, // Include the MIME type
          })
        );
      }
    } else if (data.type === 'public_key') {
      // Store the users public key
      publicKeys.set(data.username, data.publicKey)
    } else if (data.type === 'message') {
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

        // Sanitize the HTML message
        const sanitizedMessage = DOMPurify.sanitize(data.message);

        // Store the message in chat history
        const chatroomName = getChatroomName(data.username, data.recipient);
        const history = chatHistory.get(chatroomName) || [];
        history.push({
          from: data.username,
          message: sanitizedMessage,
          file: null,
          iv: data.iv,
          encryptedAESKey: data.encryptedAESKey
        });
        chatHistory.set(chatroomName, history);

        // Send the message to the recipient
        const recipientWs = connectedClients.get(data.recipient);
        if (recipientWs) {
          recipientWs.send(
            JSON.stringify({
              type: 'message',
              from: data.username,
              message: sanitizedMessage,
              iv: data.iv,
              encryptedAESKey: data.encryptedAESKey
            })
          );
        }

        // Send the message back to the sender
        ws.send(
          JSON.stringify({
            type: 'message',
            from: data.username,
            message: sanitizedMessage,
          })
        );
      }
    }
  });

  setInterval(() => {
    const now = Date.now();
    for (const [username, attempts] of failedLoginAttempts.entries()) {
      if (now - attempts.lastAttempt > LOCKOUT_DURATION) {
        failedLoginAttempts.delete(username);
      }
    }
  }, 60 * 60 * 1000); // Clean up every hour

  ws.on('close',() => {
    if (ws.username) {
      connectedClients.delete(ws.username);
      activeUsers.delete(ws.username);
      broadcastActiveUsers();

      // Log chats for all chatrooms involving this user
      chatHistory.forEach((messages, chatroomName) => {
        if (chatroomName.includes(ws.username)) {
          console.log(ws.username)
         logChatToFile(chatroomName, messages);
        }
      });
    }

    clearInterval(heartbeatInterval);
    console.log('Client disconnected');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on wss://0.0.0.0:${PORT}`);
});
