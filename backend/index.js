import {WebSocketServer} from "ws";
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dotenv from 'dotenv'
import User from './model/User.js'


dotenv.config();

const PORT = 5000

//Websocket server setup
const wss = new WebSocketServer({port: PORT})

// Stored connected clients and chatrooms
const connectedClients = new Map();
const chatrooms = new Map();

// Rate limit
const RATE_LIMIT = 5 //max msg per sec
const userMessageCounts = new Map();



//connect to Mongodb cloud and run server
//const dbURI="mongodb+srv://zhinlonton:Zhinlonton@123@seancluster.kluxn.mongodb.net/Websockets?retryWrites=true&w=majority"
mongoose.connect(process.env.dbURI).then((res)=> console.log('db Connnected! and server running')
).catch((e)=> console.log(e))

//Authenticate/Login user
async function authenticate(username, password) {
    const user = await User.findOne({username});
    if (user && (await bcrypt.compare(password, user.password))) {
        return true
    }
    return false;
}

// Register user
async function registerUser(username, password) {
    const newUser = new User({username, password});
    await newUser.save();
    console.log('new user:', newUser)
}

// Create/Join chatroom
function handleChatroom(ws, chatroomName, username) {
    if (!chatrooms.has(chatroomName)) {
        chatrooms.set(chatroomName, new Set()); 
    }
    chatrooms.get(chatroomName).add(username);
    ws.send(JSON.stringify({type: 'chatroom_joined', chatroomName}))
    console.log(`${username} Joined chatroom: ${chatroomName}`)
}

// Broadcast message to all users in the chatroom
function broadcastMessage(chatroomName, message) {
    const usersInChatroom =chatrooms.get(chatroomName);
    if (usersInChatroom) {
        usersInChatroom.forEach((username)=> {
            const clientWs = connectedClients.get(username)
            if (clientWs) {
                clientWs.send(JSON.stringify(message))
            }
        })
    }
}



//Handle Websocket connections
wss.on('connection', (ws)=>{
    console.log('New Client Connected')

    ws.on('message', async (message)=> {
        const data = JSON.parse(message);
        console.log('Recieved data:', message) // log the message to check for errors

        if (data.type === 'login') {
            if (await authenticate(data.username, data.password)) {
                connectedClients.set(data.username, ws);
                ws.send(JSON.stringify({type: 'login_successfull', username:data.username})
    )}else {
        ws.send(JSON.stringify({type:'login_failed', message:'incorrect password/user does not exist'}));
    }
        } else if (data.type === 'register') {
            try {
              await  registerUser(data.username, data.password);
              ws.send(JSON.stringify({type: 'registration_successfull'}));

            } catch (error) {
                ws.send(JSON.stringify({type: 'registration_failed', error:'Username already exists'}));
            }
        } else if (data.type === 'join_chatroom') {
            if(!connectedClients.has(data.username)){
                ws.send(JSON.stringify({type: 'error', message:'User not logged in'}));
            } return;
        } else if (data.type === 'message') {
            if(!connectedClients.has(data.username)){
                ws.send(JSON.stringify({type: 'error', message:'User not logged in'}));
            } return;
        }

        // Implement rate limit
        const count = userMessageCounts.get(data.username) || 0
        if (count >= RATE_LIMIT) {
            ws.send(JSON.stringify({type: 'rate_limit_exceeded', message:'wait for 1 min'}));
        }else {
            userMessageCounts.set(data.message, count + 1);
            broadcastMessage(data.chatroomName, {
                type: 'message',
                from:data.username,
                chatroomName: data.chatroomName,
                message:data.message
            })
        }

    });


ws.on('close', ()=> {
    //handle disconnection
    connectedClients.forEach((value, key)=> {
        if (value === ws) {
            connectedClients.delete(key)
            console.log(`${key} disconnected!`)
        }
    })

})
})







