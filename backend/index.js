import { createServer } from 'http';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './model/User.js';
import ChatHistory from './model/ChatHistory.js';
import { GridFSBucket, ObjectId } from 'mongodb';

dotenv.config();

// Server Configuration
const PORT = process.env.PORT || 5000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create HTTP server
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200);
    res.end('WebSocket server is running');
  }
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// WebSocket Server
const wss = new WebSocketServer({ server });

// Application State
const connectedClients = new Map(); // Map<username, WebSocket>
const activeUsers = new Set(); // Set of active usernames
// const chatHistory = new Map(); // Map<chatroomName, Array<message>>
const failedLoginAttempts = new Map(); // Map<username, { attempts: number, lastAttempt: number }>
const userStatus = new Map(); // Map<username, {status: 'online'|'offline', lastActive: Date}>
const typingUsers = new Map(); // Map<username, recipientUsername>

// Security Constants
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT = 5; // Max messages per second
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Connect to MongoDB
let gfsBucket;
mongoose
  .connect(process.env.dbURI, {
    maxPoolSize: 20,
    timeoutMS: 10000,
  })
  .then((conn) => {
    console.log('Connected to MongoDB');
    // Create GridFS bucket
    gfsBucket = new GridFSBucket(conn.connection.db, {
      bucketName: 'encrypted_files',
    });
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Helper Functions
function getChatroomName(user1, user2) {
  return [user1, user2].sort().join('-');
}

function broadcastActiveUsers() {
  const userList = Array.from(activeUsers).map((username) => ({
    username,
    status: userStatus.get(username)?.status || 'offline',
  }));

  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: 'user_list',
          users: userList,
        })
      );
    }
  });
}

// function logChatToFile(chatroomName, messages) {
//   const logDir = path.join(__dirname, 'chat_logs');
//   if (!existsSync(logDir)) mkdirSync(logDir);

//   const logFile = path.join(logDir, `${chatroomName}_${Date.now()}.txt`);
//   console.log(messages);
//   const logContent = messages
//     .map(
//       (msg) =>
//         `${msg.from}: ${
//           msg.message ? '[encrypted text]' : '[encrypted file]'
//         } (${new Date(msg.timestamp).toISOString()})`
//     )
//     .join('\n');

//   writeFileSync(logFile, logContent);
//   console.log(`Chat logged to ${logFile}`);
// }

// Authentication Functions
async function authenticate(username, password) {
  const now = Date.now();
  const attempts = failedLoginAttempts.get(username) || {
    attempts: 0,
    lastAttempt: 0,
  };

  // Check if account is locked
  if (
    attempts.attempts >= MAX_FAILED_ATTEMPTS &&
    now - attempts.lastAttempt < LOCKOUT_DURATION
  ) {
    return { success: false, message: 'Account locked. Try again later.' };
  }

  const user = await User.findOne({ username });
  if (!user) {
    return { success: false, message: 'User not found' };
  }

  const match = await bcrypt.compare(password, user.password);
  if (match) {
    failedLoginAttempts.delete(username);
    return { success: true, user };
  } else {
    attempts.attempts++;
    attempts.lastAttempt = now;
    failedLoginAttempts.set(username, attempts);
    return { success: false, message: 'Invalid password' };
  }
}

async function registerUser(username, password, publicKey) {
  // Validate password
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Check if user exists
  const existingUser = await User.findOne({ username });
  if (existingUser) {
    throw new Error('Username already exists');
  }

  // Create new user
  const newUser = new User({
    username,
    password,
    publicKey,
  });

  await newUser.save();
  return newUser;
}

// WebSocket Server Event Handlers
wss.on('connection', (ws, req) => {
  console.log(`New connection from ${req.socket.remoteAddress}`);

  // Track connection time
  ws.connectionTime = Date.now();
  ws.isAlive = true;

  // Setup heartbeat
  const heartbeatInterval = setInterval(() => {
    if (!ws.isAlive) {
      console.log(`Terminating connection to ${ws.username || 'unknown user'}`);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL);

  // Handle pong responses
  ws.on('pong', () => {
    ws.isAlive = true;
    if (ws.username) {
      userStatus.set(ws.username, {
        status: 'online',
        lastActive: new Date(),
      });
      broadcastUserStatus(ws.username, 'online');
    }
  });

  // Message handler
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Rate limiting
      if (data.type === 'message' || data.type === 'file') {
        const count = (ws.messageCount || 0) + 1;
        ws.messageCount = count;

        if (count > RATE_LIMIT) {
          ws.send(
            JSON.stringify({
              type: 'rate_limit_exceeded',
              message: 'Too many messages. Please wait.',
            })
          );
          return;
        }
      }

      // Handle different message types
      switch (data.type) {
        case 'login':
          await handleLogin(ws, data);
          break;
        case 'register':
          await handleRegister(ws, data);
          break;
        case 'public_key':
          handlePublicKey(ws, data);
          break;
        //typing indicator case
        case 'typing':
          await handleTypingIndicator(ws, data);
          break;
        case 'message':
          await handleEncryptedMessage(ws, data);
          break;
        case 'file':
          await handleEncryptedFile(ws, data);
          break;
        case 'get_file':
          handleGetFile(ws, data);
          break;
        case 'switch_chat':
          handleSwitchChat(ws, data);
          break;
        case 'heartbeat_ack':
          // Reset message count periodically
          if (ws.messageCount && Date.now() - (ws.lastReset || 0) > 1000) {
            ws.messageCount = 0;
            ws.lastReset = Date.now();
          }
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('Error handling message:', err);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Internal server error',
        })
      );
    }
  });

  // Cleanup on disconnect
  ws.on('close', () => {
    clearInterval(heartbeatInterval);

    if (ws.username) {
      userStatus.set(ws.username, {
        status: 'offline',
        lastActive: new Date(),
      });
      broadcastUserStatus(ws.username, 'offline');

      connectedClients.delete(ws.username);
      activeUsers.delete(ws.username);
      broadcastActiveUsers();

      // Log chats for all chatrooms involving this user
    }
  });
});
//message handler for typing indicators
async function handleTypingIndicator(ws, data) {
  if (!ws.username || !connectedClients.has(ws.username)) {
    return;
  }

  typingUsers.set(ws.username, data.recipient);

  // Notify recipient
  const recipientWs = connectedClients.get(data.recipient);
  if (recipientWs) {
    recipientWs.send(
      JSON.stringify({
        type: 'typing',
        from: ws.username,
        isTyping: true,
      })
    );
  }

  // Set timeout to clear typing status after 3 seconds
  setTimeout(() => {
    if (typingUsers.get(ws.username) === data.recipient) {
      typingUsers.delete(ws.username);
      if (recipientWs) {
        recipientWs.send(
          JSON.stringify({
            type: 'typing',
            from: ws.username,
            isTyping: false,
          })
        );
      }
    }
  }, 3000);
}
// Add new broadcast function
function broadcastUserStatus(username, status) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: 'user_status',
          username,
          status,
        })
      );
    }
  });
}

// Message Handlers
async function handleLogin(ws, data) {
  const { username, password } = data;
  const authResult = await authenticate(username, password);

  if (authResult.success) {
    // Store connection
    connectedClients.set(username, ws);
    activeUsers.add(username);
    ws.username = username;

    // Send success response
    ws.send(
      JSON.stringify({
        type: 'login_success',
        username,
        activeUsers: Array.from(activeUsers),
      })
    );

    // Broadcast updated user list
    broadcastActiveUsers();

    // Send the user's public key to all clients
    const user = await User.findOne({ username });
    if (user && user.publicKey) {
      broadcastPublicKey(username, user.publicKey);
    }

    // Send public keys of all active users to the new client
    const activeUsersList = Array.from(activeUsers);
    for (const activeUser of activeUsersList) {
      if (activeUser !== username) {
        const user = await User.findOne({ username: activeUser });
        if (user && user.publicKey) {
          ws.send(
            JSON.stringify({
              type: 'public_key',
              username: activeUser,
              publicKey: user.publicKey,
            })
          );
        }
      }
    }
  } else {
    ws.send(
      JSON.stringify({
        type: 'login_failed',
        message: authResult.message,
      })
    );
  }
}

async function handleRegister(ws, data) {
  try {
    const { username, password, publicKey } = data;
    await registerUser(username, password, publicKey);
    ws.send(JSON.stringify({ type: 'registration_success' }));
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: 'registration_failed',
        error: err.message,
      })
    );
  }
}

function handlePublicKey(ws, data) {
  if (!ws.username) return;

  // Broadcast to all other clients
  wss.clients.forEach((client) => {
    if (client !== ws && client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: 'public_key',
          username: ws.username,
          publicKey: data.publicKey,
        })
      );
    }
  });
}

async function handleEncryptedMessage(ws, data) {
  if (!ws.username || !connectedClients.has(ws.username)) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Not authenticated',
      })
    );
    return;
  }

  // Forward the encrypted message to recipient
  const recipientWs = connectedClients.get(data.recipient);
  if (recipientWs) {
    recipientWs.send(
      JSON.stringify({
        type: 'message',
        from: ws.username,
        encryptedMessage: data.encryptedMessage,
        iv: data.iv,
        encryptedAesKey: data.encryptedAesKey,
      })
    );
  }

  // Store chat history to db (both encrypted and plaintext versions)
  try {
    const chatroomName = getChatroomName(ws.username, data.recipient);
    const newMessage = new ChatHistory({
      chatroomName,
      from: ws.username,
      message: data.message,
      encryptedMessage: data.encryptedMessage,
      iv: data.iv,
      encryptedAesKey: data.encryptedAesKey,
      timestamp: new Date(),
    });
    await newMessage.save();
  } catch (error) {
    console.error('Error saving message to database:', error);
  }
}

async function handleEncryptedFile(ws, data) {
  if (!ws.username || !connectedClients.has(ws.username)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }

  try {
    // Convert encrypted data to Buffer
    const fileBuffer = Buffer.from(data.encryptedFile);

    // Create a new file in GridFS
    const uploadStream = gfsBucket.openUploadStream(
      `${Date.now()}_${data.fileName}`,
      {
        metadata: {
          sender: ws.username,
          recipient: data.recipient,
          iv: data.iv,
          encryptedAesKey: data.encryptedAesKey,
          mimeType: data.mimeType,
          fileName: data.fileName,
        },
      }
    );

    uploadStream.end(fileBuffer);

    uploadStream.on('finish', async () => {
      // Add to chat history immediately
      const chatroomName = getChatroomName(ws.username, data.recipient);
      const newMessage = new ChatHistory({
        chatroomName,
        from: ws.username,
        message: '[encrypted file]',
        fileId: uploadStream.id,
        iv: data.iv,
        encryptedAesKey: data.encryptedAesKey,
        mimeType: data.mimeType,
        fileName: data.fileName,
        timestamp: new Date(),
      });
      await newMessage.save();

      // Send to recipient
      const recipientWs = connectedClients.get(data.recipient);
      if (recipientWs) {
        recipientWs.send(
          JSON.stringify({
            type: 'file',
            from: ws.username,
            fileId: uploadStream.id.toString(),
            iv: data.iv,
            encryptedAesKey: data.encryptedAesKey,
            mimeType: data.mimeType,
            fileName: data.fileName,
          })
        );
      }

      // Send confirmation to sender
      ws.send(
        JSON.stringify({
          type: 'file_ack',
          fileId: uploadStream.id.toString(),
          fileName: data.fileName,
        })
      );
    });
  } catch (error) {
    console.error('Error handling encrypted file:', error);
    ws.send(
      JSON.stringify({ type: 'error', message: 'Failed to process file' })
    );
  }
}
async function handleGetFile(ws, data) {
  try {
    const fileId = new ObjectId(data.fileId);
    const fileDoc = await gfsBucket.find({ _id: fileId }).next();

    if (!fileDoc) {
      throw new Error('File not found');
    }

    const chunks = [];
    const downloadStream = gfsBucket.openDownloadStream(fileId);

    downloadStream.on('data', (chunk) => chunks.push(chunk));
    downloadStream.on('end', () => {
      const fileBuffer = Buffer.concat(chunks);
      ws.send(
        JSON.stringify({
          type: 'file_data',
          fileId: data.fileId,
          from: fileDoc.metadata.sender,
          encryptedFile: Array.from(fileBuffer),
          iv: fileDoc.metadata.iv,
          encryptedAesKey: fileDoc.metadata.encryptedAesKey,
          mimeType: fileDoc.metadata.mimeType,
        })
      );
    });
  } catch (error) {
    console.error('Error retrieving file:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Could not retrieve file',
      })
    );
  }
}

async function handleSwitchChat(ws, data) {
  if (!ws.username || !connectedClients.has(ws.username)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }

  const chatroomName = getChatroomName(data.username, data.recipient);
  try {
    const history = await ChatHistory.find({ chatroomName })
      .sort({ timestamp: 1 })
      .lean()
      .exec();

    ws.send(
      JSON.stringify({
        type: 'chat_history',
        chatroomName,
        messages: history,
      })
    );
  } catch (error) {
    console.error('Error retrieving chat history:', error);
    ws.send(
      JSON.stringify({ type: 'error', message: 'Could not load chat history' })
    );
  }
}

function broadcastPublicKey(username, publicKey) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client.username !== username) {
      client.send(
        JSON.stringify({
          type: 'public_key',
          username,
          publicKey,
        })
      );
    }
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
server.on('request', async (req, res) => {
  if (req.url.startsWith('/api/files/') && req.method === 'GET') {
    try {
      const fileId = new ObjectId(req.url.split('/').pop());
      const fileDoc = await gfsBucket.find({ _id: fileId }).next();

      if (!fileDoc) {
        return res.status(404).send('File not found');
      }

      res.setHeader('Content-Type', fileDoc.metadata.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${fileDoc.metadata.fileName}"`
      );

      const downloadStream = gfsBucket.openDownloadStream(fileId);
      downloadStream.pipe(res);
    } catch (error) {
      console.error('File retrieval error:', error);
      res.status(500).send('Error retrieving file');
    }
  }
});

// Cleanup failed login attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [username, attempts] of failedLoginAttempts.entries()) {
    if (now - attempts.lastAttempt > LOCKOUT_DURATION) {
      failedLoginAttempts.delete(username);
    }
  }
}, 60 * 1000); // Every minute
