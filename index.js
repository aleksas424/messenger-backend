const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chats');
const messageRoutes = require('./routes/messages');
const db = require('./config/db');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer nustatymai failų įkėlimui
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Maršrutai
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
// Laikinai pašaliname upload.single('file'), kad patikrintume
app.use('/api/messages', messageRoutes);
// app.use('/api/messages', upload.single('file'), messageRoutes);

app.set('socketio', io);

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined chat ${chatId}`);
  });

  socket.on('leaveChat', (chatId) => {
    socket.leave(chatId);
    console.log(`User ${socket.id} left chat ${chatId}`);
  });

  socket.on('sendMessage', (message) => {
    io.to(message.chat_id).emit('receiveMessage', message);
  });

  socket.on('editMessage', ({ chatId, updatedMessage }) => {
    io.to(chatId).emit('messageEdited', updatedMessage);
  });

  socket.on('deleteMessage', ({ chatId, messageId }) => {
    io.to(chatId).emit('messageDeleted', messageId);
  });

  socket.on('pinMessage', ({ chatId, messageId }) => {
    io.to(chatId).emit('messagePinned', messageId);
  });

  socket.on('unpinMessage', (chatId) => {
    io.to(chatId).emit('messageUnpinned');
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

// Patikriname DB prisijungimą
db.query('SELECT 1')
  .then(() => console.log('Connected to database'))
  .catch((err) => console.error('Database connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});