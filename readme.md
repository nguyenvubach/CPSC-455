````md
# WebSocket Chatbox

## Introduction

A real-time chat application that allows multiple users to communicate instantly, with multi-layer encryption.

---

## Features

### Phase 1:

- Real-time Messaging
- Secure Connection
- User Authentication
- Rate Limiting
- Connection Handling

### Phase 2:

- User-friendly Interface
- File Sharing Capability
- Emoji & Rich Media Support
- Security Hardening
- Enhanced User Authentication

---

## User Guide

### Prerequisites

- `.env`, SSL, and chat log files will be provided via Canvas submission in a zip file.
- Ensure that you have **Node.js** and **npm** installed.

---

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/nguyenvubach/CPSC-455.git
   ```
````

2. Navigate to the project directory:
   ```bash
   cd CPSC-455
   ```
3. Split the terminal into **four**: one for the backend and three (or more) for the frontend.
4. Setup the backend:
   ```bash
   cd backend
   npm i
   ```
5. Setup the frontend:
   ```bash
   cd frontend
   npm i
   ```

---

## SSL Installation

1. Navigate back to the main project folder:
   ```bash
   cd ../
   ```
2. Generate an SSL certificate:
   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout private_key.pem -out certificate.pem -days 365 -nodes -subj "/CN=localhost" -addext "subjectAltName=IP:your_IP_address"
   ```
3. Move the newly created `.pem` files into the `ssl` folder.
4. Update the **index.js** file (lines 19-20) with the correct paths:
   ```
   cert: readFileSync('../ssl/certificate.pem'), // Replace with your certificate path
   key: readFileSync('../ssl/private_key.pem'), // Replace with your private key path
   ```

---

## Running the Application

### Backend:

```bash
npm start
```

### Frontend:

For all frontend terminals, run:

```bash
npm start
```

---

## Technologies Used

- JavaScript (JS)
- MongoDB
- HTML / CSS
- DOM Elements

---

## AI Integration

- AI usage for **README.md** and **changelog.md** formatting.
- AI guidance for **encryption implementation** and **security explanations**.

---
