let socket;
let currentUser;
let currentRecipient

const chatHistory = new Map()

// DOM Elements
const authSection = document.getElementById('auth-section');
const chatroomSection = document.getElementById('chat-section');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const userListDiv = document.getElementById('user-list')
const createJoinBtn = document.getElementById('create-join-btn');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesDiv = document.getElementById('messages');
const authErrorDiv = document.getElementById('auth-error');
const chatroomErrorDiv = document.getElementById('chatroom-error');
const messageBox = document.getElementById('message-box');



function displayMessages(messages) {
  messagesDiv.innerHTML = '' //clear the chat window
  messages.forEach(msg => {
    if (msg.file) {
      //Display file
    // displayFile(msg.file, msg.from, msg.mimeType)
    }
    else {
      //Display text message
      const messageElement = document.createElement('div')
      messageElement.textContent = `${msg.from}: ${msg.message}`;
      messagesDiv.appendChild(messageElement);
    };

  });
  messagesDiv.scrollTop = messagesDiv.scrollHeight //auto-scroll to the bottom

}

//Generate a unique chatroom name
function getChatroomName(user1, user2){
  const users = [user1, user2].sort(); //Sort usernames alphabetiaclly
  return users.join('-')
}

// Initialize WebSocket connection
function initializeWebSocket() {
  socket = new WebSocket('wss://localhost:5000');

  socket.onopen = () => {
    console.log('WebSocket connection established');
  };


  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    if (data.type === 'login_successfull') {
      currentUser = data.username;
      authSection.style.display = 'none';
      chatroomSection.classList.add('visible');
      authErrorDiv.textContent = '';
    } else if (data.type === 'login_failed') {
      authErrorDiv.textContent = data.message;
    } else if (data.type === 'registration_successfull') {
      alert('Registration successful. Please login.');
      authErrorDiv.textContent = '';
    } else if (data.type === 'registration_failed') {
      authErrorDiv.textContent = data.error;
    } else if (data.type === 'chat_history') {
      //Load chat history for the selected recipient
      chatHistory.set(data.chatroomName, data.messages)
        displayMessages(data.messages)
    } else if (data.type === 'message') {
     //Add the message to the chat history
     const chatroomName = getChatroomName(currentUser, data.from)
     const history = chatHistory.get(chatroomName) || []
     history.push({
      from: data.from,
      message:data.message,
      file:null,
      mimeType:null
     })
     chatHistory.set(chatroomName, history)

     //Display the message if the recipient is currently selected
     if (currentRecipient === data.from) {
      displayMessages(history)
     }
    } else if (data.type === 'user_list'){
        updateUserList(data.users) //update the user list
    }
    
    else if (data.type === 'error') {
      chatroomErrorDiv.textContent = data.message;
      alert(data.message)
    } else if (data.type === 'rate_limit_exceeded') {
      alert('Rate limit exceeded. Please wait before sending more messages.');
    } else if (data.type === 'heartbeat') {
      // Respond to heartbeat
      socket.send(JSON.stringify({ type: 'heartbeat_ack' }));
    }
  };

  

  socket.onclose = () => {
    console.log('WebSocket connection closed');
    alert('Connection lost. Please refresh the page.');
  };
}

//Update the user list in the sidebar
  function updateUserList(users) {
    console.log('users', users)
    userListDiv.innerHTML = ''; //reset/clear the current list
    users.forEach((user)=> {
      if (user !== currentUser) {
        // Don't show the current user in the list
        const userElement = document.createElement('div')
        userElement.textContent = user;
        userElement.style.cursor = 'pointer';
        userElement.style.padding = '5px'
        userElement.addEventListener('click', ()=> switchUser(user));
        userListDiv.appendChild(userElement);
      }
    })
  }

  //Switch to a different user's chat

  function switchUser(user){
    currentRecipient =user;  //set the recipient
    messagesDiv.innerHTML = '' //clear the chat window

    //Request chat history from the backend
    socket.send(
      JSON.stringify({
        type: 'switch_chat',
        username:currentUser,
        recipient:user,
      })
    )

  }
// Send message
sendBtn.addEventListener('click', () => {
  const message = messageBox.value; // Ensure 'messageBox' is correctly defined
  if (message && socket && currentRecipient) {
    // Add the message to the chat history for the sender
    const chatroomName = getChatroomName(currentUser, currentRecipient);
    const history = chatHistory.get(chatroomName) || [];
    history.push({ from: currentUser, message, file: null, mimeType: null });
    chatHistory.set(chatroomName, history);

    // Display the updated messages
    displayMessages(history);

    // Send the message to the backend
    socket.send(
      JSON.stringify({
        type: 'message',
        username: currentUser,
        recipient: currentRecipient,
        message,
      })
    );

    // Clear the message input
    messageBox.value = '';
  } else {
    alert('Please select a user and enter a message.');
  }
});



// Login
loginBtn.addEventListener('click', () => {
  const username = usernameInput.value;
  const password = passwordInput.value;
  if (username && password && socket) {
    socket.send(JSON.stringify({ type: 'login', username, password }));
  } else {
    authErrorDiv.textContent = 'Please enter a username and password.';
  }
});

// Register
registerBtn.addEventListener('click', () => {
  const username = usernameInput.value;
  const password = passwordInput.value;
  if (username && password && socket) {
    socket.send(JSON.stringify({ type: 'register', username, password }));
  } else {
    authErrorDiv.textContent = 'Please enter a username and password.';
  }
});

// Initialize WebSocket on page load
initializeWebSocket();
