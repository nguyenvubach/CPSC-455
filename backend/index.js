// import WebSocket from "ws";
// import bcrypt from 'bcrypt';
// import mongoose from 'mongoose';
// import cors from 'cors';
// import dotenv from 'dotenv'
const WebSocket = require('ws')
const mongoose = require('mongoose')
const dotenv =require('dotenv')

dotenv.config();

const PORT = 5000

//Websocket server setup
const wss = new WebSocket.Server({port: 8765})

// Stored connected clients
const ConnectedClients = new Map();

//connect to Mongodb cloud and run server
mongoose.connect(process.env.dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology:true,
}).then((res)=> console.log('db Connnected!')
).catch((e)=> console.log(e))



wss.on('connection', (ws)=>{
    console.log('New Client Connected')
})

wss.on('close', ()=> {
    //handle disconnection
    ConnectedClients.forEach((value, key)=> {
        if (value === ws) {
            ConnectedClients.delete(key)
            console.log(`${key} disconnected!`)
        }
    })

})







