// DOM Elements
const authSection = document.getElementById('auth-section');
const chatroomSection = document.getElementById('chat-section');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const messageBox = document.getElementById('message-box');
const sendBtn = document.getElementById('send-btn');
const messagesDiv = document.getElementById('messages');
const authErrorDiv = document.getElementById('auth-error');
const userListDiv = document.getElementById('user-list');
const fileInput = document.getElementById('file-input');
const emojiPicker = document.getElementById('emoji-picker');
const emojiBtn = document.getElementById('emoji-btn');
const boldBtn = document.getElementById('bold-btn');
const italicBtn = document.getElementById('italic-btn');
const linkBtn = document.getElementById('link-btn');

// Application State
let socket;
let currentUser;
let currentRecipient;
const chatHistory = new Map();
let userKeyPair; // User's RSA key pair
let typingTimeout;
const publicKeys = new Map(); // Map<username, CryptoKey> of other users' public keys
const userStatus = new Map(); // Map<username, 'online'|'offline'>
const typingStatus = new Map(); // Map<username, boolean> for typing status




// Initialize WebSocket connection
function initializeWebSocket() {
  socket = new WebSocket('https://chatinsocket-j5kr.onrender.com'); // Replace with your backend URL
 //socket = new WebSocket('http://localhost:5000'); // Replace with your backend URL



  socket.onopen = () => {
    console.log('WebSocket connection established');
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received message:', data);

      if (data.type === 'login_success') {
        handleLoginSuccess(data);
      } else if (data.type === 'login_failed') {
        authErrorDiv.textContent = data.message;
      } else if (data.type === 'registration_success') {
        alert('Registration successful. Please login.');
        authErrorDiv.textContent = '';
      } else if (data.type === 'registration_failed') {
        authErrorDiv.textContent = data.error;
      } else if (data.type === 'chat_history') {
        await handleChatHistory(data);
      } else if (data.type === 'user_status') {
        userStatus.set(data.username, data.status);
        updateUserList(Array.from(userStatus.keys()));
      } else if (data.type === 'typing') {
        typingStatus.set(data.from, data.isTyping);
        updateTypingIndicator(data.from);
      } else if (data.type === 'message') {
        await handleIncomingMessage(data);
      } else if (data.type === 'file') {
        await handleIncomingFile(data);
      } else if (data.type === 'file_reference') {
        await handleFileReference(data);
      } else if (data.type === 'user_list') {
        data.users.forEach((user) => {
          const username = typeof user === 'string' ? user : user.username;
          const status =
            typeof user === 'string'
              ? userStatus.get(user) || 'offline'
              : user.status;
          userStatus.set(username, status);
        });
        updateUserList(data.users);
      } else if (data.type === 'public_key') {
        await handlePublicKey(data);
      } else if (data.type === 'error') {
        console.error('Server error:', data.message);
      } else if (data.type === 'heartbeat') {
        socket.send(JSON.stringify({ type: 'heartbeat_ack' }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
    alert('Connection lost. Please refresh the page.');
  };
}

// Generate RSA key pair
async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Store keys in IndexedDB
async function storeKeys(username, keyPair) {
  try {
    // Export keys to JWK format
    const publicKeyJwk = await window.crypto.subtle.exportKey(
      'jwk',
      keyPair.publicKey
    );
    const privateKeyJwk = await window.crypto.subtle.exportKey(
      'jwk',
      keyPair.privateKey
    );

    // Store in IndexedDB or localStorage
    localStorage.setItem(`${username}_publicKey`, JSON.stringify(publicKeyJwk));
    localStorage.setItem(
      `${username}_privateKey`,
      JSON.stringify(privateKeyJwk)
    );
  } catch (error) {
    console.error('Error storing keys:', error);
    throw error;
  }
}

// Load keys from storage
async function loadKeys(username) {
  try {
    const publicKeyJwk = JSON.parse(
      localStorage.getItem(`${username}_publicKey`)
    );
    const privateKeyJwk = JSON.parse(
      localStorage.getItem(`${username}_privateKey`)
    );

    if (!publicKeyJwk || !privateKeyJwk) return null;

    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    );

    const privateKey = await window.crypto.subtle.importKey(
      'jwk',
      privateKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    );

    return { publicKey, privateKey };
  } catch (error) {
    console.error('Error loading keys:', error);
    return null;
  }
}

// Encrypt message with recipient's public key
async function encryptMessage(message, recipientUsername) {
  try {
    const recipientPublicKey = publicKeys.get(recipientUsername);
    if (!recipientPublicKey) throw new Error('Recipient public key not found');

    // Generate AES key
    const aesKey = await window.crypto.subtle.generateKey(
      { name: 'AES-CBC', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Generate IV
    const iv = window.crypto.getRandomValues(new Uint8Array(16));

    // Encrypt message with AES
    const encryptedMessage = await window.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      aesKey,
      new TextEncoder().encode(message)
    );

    // Export AES key
    const exportedAesKey = await window.crypto.subtle.exportKey('raw', aesKey);

    // Encrypt AES key with RSA
    const encryptedAesKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPublicKey,
      exportedAesKey
    );

    return {
      iv: Array.from(iv), // Convert to regular array
      encryptedMessage: Array.from(new Uint8Array(encryptedMessage)), // Convert to regular array
      encryptedAesKey: Array.from(new Uint8Array(encryptedAesKey)), // Convert to regular array
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

// Decrypt message with our private key
async function decryptMessage(encryptedData, iv, encryptedAesKey) {
  try {
    // Convert arrays back to Uint8Array if needed
    const encryptedAesKeyBuf = new Uint8Array(encryptedAesKey).buffer;
    const ivBuf = new Uint8Array(iv);
    const encryptedDataBuf = new Uint8Array(encryptedData).buffer;

    // Decrypt the AES key with our private key
    const decryptedAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      userKeyPair.privateKey,
      encryptedAesKeyBuf
    );

    // Import the AES key
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      decryptedAesKey,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the message
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBuf },
      aesKey,
      encryptedDataBuf
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

// Encrypt file with recipient's public key
async function encryptFile(file, recipientUsername) {
  try {
    // Get recipient's public key
    const recipientPublicKey = publicKeys.get(recipientUsername);
    if (!recipientPublicKey) throw new Error('Recipient public key not found');

    // Generate a random AES key for this file
    const aesKey = await window.crypto.subtle.generateKey(
      { name: 'AES-CBC', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();

    // Encrypt file with AES
    const iv = window.crypto.getRandomValues(new Uint8Array(16));
    const encryptedFile = await window.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      aesKey,
      fileBuffer
    );

    // Export and encrypt the AES key with RSA
    const exportedAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedAesKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPublicKey,
      exportedAesKey
    );

    return {
      iv: Array.from(iv),
      encryptedFile: Array.from(new Uint8Array(encryptedFile)),
      encryptedAesKey: Array.from(new Uint8Array(encryptedAesKey)),
      mimeType: file.type,
    };
  } catch (error) {
    console.error('File encryption error:', error);
    throw error;
  }
}

// Decrypt file with our private key
async function decryptFile(encryptedData, iv, encryptedAesKey) {
  try {
    // Decrypt the AES key with our private key
    const decryptedAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      userKeyPair.privateKey,
      new Uint8Array(encryptedAesKey)
    );

    // Import the AES key
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      decryptedAesKey,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the file
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: new Uint8Array(iv) },
      aesKey,
      new Uint8Array(encryptedData)
    );

    return new Uint8Array(decrypted);
  } catch (error) {
    console.error('File decryption error:', error);
    throw error;
  }
}

// Event Handlers
async function handleLoginSuccess(data) {
  currentUser = data.username;

  if (data.activeUsers) {
    data.activeUsers.forEach((user) => {
      userStatus.set(user, 'online');
    });
  }
  // Generate or load key pair
const loadedKeys = await loadKeys(currentUser);
  if (loadedKeys) {
    userKeyPair = loadedKeys;
  } else {
    userKeyPair = await generateKeyPair();
    await storeKeys(currentUser, userKeyPair);
  }

  // Export and send public key to server
  const publicKeyJwk = await window.crypto.subtle.exportKey(
    'jwk',
    userKeyPair.publicKey
  );
  socket.send(
    JSON.stringify({
      type: 'public_key',
      publicKey: publicKeyJwk,
    })
  );

  // Update UI
  authSection.style.display = 'none';
  chatroomSection.classList.add('visible');
  authErrorDiv.textContent = '';
}

async function handlePublicKey(data) {
  try {
    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      data.publicKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    );
    publicKeys.set(data.username, publicKey);
  } catch (error) {
    console.error('Error importing public key:', error);
  }
}

// Handle chat history and incoming messages
async function handleChatHistory(data) {
  const decryptedMessages = await Promise.all(
    data.messages.map(async (msg) => {
      try {
        // Skip decryption for messages sent by current user
        if (msg.from === currentUser) {
          return { from: msg.from, message: msg.message || '[Your message]' };
        }

        // Only decrypt messages sent by others
        if (msg.encryptedMessage && msg.iv && msg.encryptedAesKey) {
          const decrypted = await decryptMessage(
            msg.encryptedMessage,
            msg.iv,
            msg.encryptedAesKey
          );
          return { from: msg.from, message: decrypted };
        } else if (msg.encryptedFile) {
          const decryptedFile = await decryptFile(
            msg.encryptedFile,
            msg.iv,
            msg.encryptedAesKey
          );
          return {
            from: msg.from,
            file: decryptedFile,
            mimeType: msg.mimeType,
          };
        }
        return msg;
      } catch (error) {
        console.error('Error decrypting message:', error);
        return { from: msg.from, message: '[Error decrypting message]' };
      }
    })
  );

  chatHistory.set(data.chatroomName, decryptedMessages);
  displayMessages(decryptedMessages);
}

async function handleIncomingMessage(data) {
  try {
    const decryptedMessage = await decryptMessage(
      data.encryptedMessage,
      data.iv,
      data.encryptedAesKey
    );

    const chatroomName = getChatroomName(currentUser, data.from);
    const history = chatHistory.get(chatroomName) || [];
    history.push({ from: data.from, message: decryptedMessage });
    chatHistory.set(chatroomName, history);

    if (currentRecipient === data.from) {
      displayMessages(history);
    }
  } catch (error) {
    console.error('Error decrypting incoming message:', error);
  }
}

async function handleIncomingFile(data) {
  try {
    const decryptedFile = await decryptFile(
      data.encryptedFile,
      data.iv,
      data.encryptedAesKey
    );

    const chatroomName = getChatroomName(currentUser, data.from);
    const history = chatHistory.get(chatroomName) || [];
    history.push({
      from: data.from,
      file: decryptedFile,
      mimeType: data.mimeType,
    });
    chatHistory.set(chatroomName, history);

    if (currentRecipient === data.from) {
      displayFile(decryptedFile, data.from, data.mimeType);
    }
  } catch (error) {
    console.error('Error decrypting incoming file:', error);
  }
}
async function handleFileReference(data) {
  try {
    // Get the file reference from Firebase
    const fileRef = ref(storage, data.fileRef);
    const encryptedFileData =data.encryptedFileData

    // Decrypt the file
    const decryptedFile = await decryptFile(
      Array.from(encryptedFileData),
      data.iv,
      data.encryptedAesKey
    );

    // Display the file
    displayFile(decryptedFile, data.from, data.mimeType);

    // Add to chat history
    const chatroomName = getChatroomName(currentUser, data.from);
    const history = chatHistory.get(chatroomName) || [];
    history.push({
      from: data.from,
      file: decryptedFile,
      mimeType: data.mimeType,
    });
    chatHistory.set(chatroomName, history);
  } catch (error) {
    console.error('Error handling file reference:', error);
  }
}

// UI Functions
function displayMessages(messages) {
  messagesDiv.innerHTML = '';
  messages.forEach((msg) => {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';

    if (msg.from === currentUser) {
      // Display sender's own messages directly
      messageElement.innerHTML = `<strong>You:</strong> ${
        formatMessage(msg.message) || '[Your Message]'
      }`;
    } else if (msg.file) {
      // Handle received files
      displayFile(msg.file, msg.from, msg.mimeType);
      return;
    } else {
      messageElement.innerHTML = `<strong>${msg.from}:</strong> ${
        formatMessage(msg.message) || '[Error displaying message]'
      }`;
    }

    messagesDiv.appendChild(messageElement);
  });
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function displayFile(fileData, from, mimeType = 'application/octet-stream') {
  const loading = document.createElement('div');
  loading.textContent = 'Loading image...';
  fileElement.appendChild(loading);

  img.onload = () => {
    URL.revokeObjectURL(fileUrl);
    loading.remove();
  };

  img.onerror = () => {
    fileElement.textContent = 'Could not load image';
    URL.revokeObjectURL(fileUrl);
  };

  const fileBlob = new Blob([fileData], { type: mimeType });
  const fileUrl = URL.createObjectURL(fileBlob);

  const fileElement = document.createElement('div');
  fileElement.className = 'message';

  if (mimeType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = fileUrl;
    img.style.maxWidth = '200px';
    img.style.maxHeight = '200px';
    img.onload = () => URL.revokeObjectURL(fileUrl);
    fileElement.appendChild(img);
  } else {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = `file_${Date.now()}`;
    link.textContent = 'Download File';
    link.onclick = () => URL.revokeObjectURL(fileUrl);
    fileElement.appendChild(link);
  }

  const senderElement = document.createElement('div');
  senderElement.textContent = `${from}:`;
  fileElement.prepend(senderElement);

  messagesDiv.appendChild(fileElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Update user list
function updateUserList(users) {
  userListDiv.innerHTML = '';

  // users parameter now contains the full list with status
  users.forEach((user) => {
    const username = typeof user === 'string' ? user : user.username;
    const status =
      typeof user === 'string'
        ? userStatus.get(user) || 'offline'
        : user.status;

    if (username !== currentUser) {
      const userElement = document.createElement('div');
      userElement.className = 'user-item';

      const statusIndicator = document.createElement('span');
      statusIndicator.className = `status-indicator ${status}`;
      statusIndicator.title = status;

      const usernameSpan = document.createElement('span');
      usernameSpan.textContent = username;
      usernameSpan.style.cursor = 'pointer';

      userElement.appendChild(statusIndicator);
      userElement.appendChild(usernameSpan);
      userElement.addEventListener('click', () => switchUser(username));
      userListDiv.appendChild(userElement);
    }
  });
}

function getChatroomName(user1, user2) {
  return [user1, user2].sort().join('-');
}

function switchUser(user) {
  currentRecipient = user;
  messagesDiv.innerHTML = '';

  socket.send(
    JSON.stringify({
      type: 'switch_chat',
      username: currentUser,
      recipient: user,
    })
  );
}

// Event Listeners
sendBtn.addEventListener('click', async () => {
  const message = messageBox.value.trim();
  if (!message || !currentRecipient) return;

  try {
    // Encrypt the message
    const encrypted = await encryptMessage(message, currentRecipient);

    // Add to local chat history (store plaintext for sender)
    const chatroomName = getChatroomName(currentUser, currentRecipient);
    const history = chatHistory.get(chatroomName) || [];
    history.push({
      from: currentUser,
      message: message, // Plaintext for sender
    });
    chatHistory.set(chatroomName, history);
    displayMessages(history);

    // Send encrypted message to server
    socket.send(
      JSON.stringify({
        type: 'message',
        recipient: currentRecipient,
        encryptedMessage: encrypted.encryptedMessage,
        iv: encrypted.iv,
        encryptedAesKey: encrypted.encryptedAesKey,
      })
    );

    messageBox.value = '';
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message: ' + error.message);
  }
});


fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || !currentRecipient) return;

  try {
    // 1. Encrypt the file
    const encrypted = await encryptFile(file, currentRecipient);

    // 6. Send reference to recipient
    socket.send(JSON.stringify({
      type: 'file_reference',
      username: currentUser,
      recipient: currentRecipient,
      fileRef: encrypted.encryptedFile,
      iv: encrypted.iv,
      encryptedAesKey: encrypted.encryptedAesKey,
      mimeType: file.type,
      fileName: file.name
    }));

    // 7. Display upload confirmation
    const placeholder = document.createElement('div');
    placeholder.className = 'message';
    placeholder.innerHTML = `<strong>You:</strong> [File uploaded: ${file.name}]`;
    messagesDiv.appendChild(placeholder);

  } catch (error) {
    console.error('File upload error:', error);
    alert(`File upload failed: ${error.message}`);
  } finally {
    fileInput.value = '';
  }
});
loginBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (username && password) {
    socket.send(
      JSON.stringify({
        type: 'login',
        username,
        password,
      })
    );
  } else {
    authErrorDiv.textContent = 'Please enter username and password';
  }
});

registerBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (username && password) {
    try {
      // Generate key pair
      const keyPair = await generateKeyPair();
      userKeyPair = keyPair;

      // Export public key to JWK format
      const publicKeyJwk = await window.crypto.subtle.exportKey(
        'jwk',
        keyPair.publicKey
      );

      // Store keys locally
      await storeKeys(username, keyPair);

      // Send registration request with public key
      socket.send(
        JSON.stringify({
          type: 'register',
          username,
          password,
          publicKey: publicKeyJwk,
        })
      );
    } catch (error) {
      console.error('Registration error:', error);
      authErrorDiv.textContent = 'Registration failed';
    }
  } else {
    authErrorDiv.textContent = 'Please enter username and password';
  }
});
// Bold formatting
boldBtn.addEventListener('click', () => {
  const selectedText = messageBox.value.substring(
    messageBox.selectionStart,
    messageBox.selectionEnd
  );
  if (selectedText) {
    const newText = `**${selectedText}**`.trim();
    messageBox.setRangeText(
      newText,
      messageBox.selectionStart,
      messageBox.selectionEnd,
      'end'
    );
  }
});
// Italic formatting
italicBtn.addEventListener('click', () => {
  const selectedText = messageBox.value.substring(
    messageBox.selectionStart,
    messageBox.selectionEnd
  );
  if (selectedText) {
    const newText = `*${selectedText}*`.trim();
    messageBox.setRangeText(
      newText,
      messageBox.selectionStart,
      messageBox.selectionEnd,
      'end'
    );
  }
});
messageBox.addEventListener('input', () => {
  if (!currentRecipient) return;

  // Clear previous timeout
  if (typingTimeout) clearTimeout(typingTimeout);

  // Send typing indicator
  socket.send(
    JSON.stringify({
      type: 'typing',
      recipient: currentRecipient,
    })
  );

  // Set timeout to stop typing indicator after 2 seconds of inactivity
  typingTimeout = setTimeout(() => {
    socket.send(
      JSON.stringify({
        type: 'typing',
        recipient: currentRecipient,
        isTyping: false,
      })
    );
  }, 2000);
});

const pickerOptions = {
  onEmojiSelect: (emoji) => {
    messageBox.value += emoji.native; // Insert the selected emoji into the message box
    emojiPicker.style.display = 'none'; // Hide the picker after selection
  },
};
const picker = new EmojiMart.Picker(pickerOptions);

// Append the picker to the emoji-picker container
emojiPicker.appendChild(picker);

// Toggle emoji picker visibility
emojiBtn.addEventListener('click', () => {
  emojiPicker.style.display =
    emojiPicker.style.display === 'none' ? 'block' : 'none';
});
//typing indicator
function updateTypingIndicator(username) {
  const isTyping = typingStatus.get(username);
  const typingElement = document.getElementById(`typing-${username}`);

  if (isTyping) {
    if (!typingElement) {
      const newTypingElement = document.createElement('div');
      newTypingElement.id = `typing-${username}`;
      newTypingElement.textContent = `${username} is typing...`;
      newTypingElement.className = 'typing-indicator';
      messagesDiv.appendChild(newTypingElement);
    }
  } else {
    if (typingElement) {
      typingElement.remove();
    }
  }
}

// Function to parse and sanitize formatted text
function formatMessage(text) {
  // Convert markdown to HTML
  const html = marked.parse(text);
  // Sanitize the HTML to prevent XSS attacks
  return DOMPurify.sanitize(html);
}

// Initialize the application
initializeWebSocket();
