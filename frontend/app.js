let socket;
let currenntUser;
let currentChatroom;

// DOM elements
const authSection = document.getElementById('auth-section')
const chatroomSection = document.getElementById('chatroom-section')
const usernameInput = document.getElementById('username')
const passwordInput = document.getElementById('password')
const loginBtn = document.getElementById('login-btn')
const registerBtn = document.getElementById('register-btn')
const createJoinBtn = document.getElementById('create-join-btn')
const messageInput = document.getElementById('message-input')
const sendBtn = document.getElementById('chatroom-name')
const messagesDiv = document.getElementById('messages')
const authErrorDiv = document.getElementById('auth-error')
const chatroomErrorDiv = document.getElementById('chatroom-error')


//Initialize WebSocket connection
function InitializeWebsocket() {
    socket = new WebSocket('ws://localhost:5000');

    socket.onopen=()=> {
        console.log('Websocket connection established')
    };
    
    socket.onmessage =(event)=> {
        const data = JSON.parse(event.data)
        console.log('Message recieved:', data)

        if(data.type === 'login_successfull'){
            currenntUser = data.username
            authSection.style.display = 'none';
            chatroomSection.style.display = 'none';
            authErrorDiv.textContent  = ''
        }
    }
}

