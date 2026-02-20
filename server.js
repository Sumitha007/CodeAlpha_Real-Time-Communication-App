'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const express = require('express');
const { Server } = require('socket.io');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage — filenames are sanitised to prevent path traversal
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'application/pdf',
];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Media upload endpoint
app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ url: `/uploads/${req.file.filename}`, mimetype: req.file.mimetype });
});

// Safe error messages exposed to clients
const SAFE_ERROR_MESSAGES = new Set([
  'File type not allowed',
  'No file uploaded',
]);

// Error handler for multer and other middleware errors
app.use((err, _req, res, _next) => {
  const message = SAFE_ERROR_MESSAGES.has(err.message) ? err.message : 'Bad request';
  res.status(400).json({ error: message });
});

// Track connected users: socketId -> { username, room }
const users = new Map();

io.on('connection', (socket) => {
  // User joins with a username and room
  socket.on('join', ({ username, room }) => {
    if (!username || !room) return;

    const safeUsername = String(username).slice(0, 30).trim();
    const safeRoom = String(room).slice(0, 30).trim();

    if (!safeUsername || !safeRoom) return;

    users.set(socket.id, { username: safeUsername, room: safeRoom });
    socket.join(safeRoom);

    // Notify room that a user joined
    socket.to(safeRoom).emit('system', {
      message: `${safeUsername} joined the room`,
      timestamp: Date.now(),
    });

    // Send the updated user list to everyone in the room
    io.to(safeRoom).emit('room-users', getRoomUsers(safeRoom));
  });

  // Handle a chat message
  socket.on('message', ({ text }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const safeText = String(text).slice(0, 2000).trim();
    if (!safeText) return;

    io.to(user.room).emit('message', {
      id: `${socket.id}-${Date.now()}`,
      username: user.username,
      text: safeText,
      timestamp: Date.now(),
    });
  });

  // Handle a media message (URL returned from /upload)
  socket.on('media', ({ url, mimetype }) => {
    const user = users.get(socket.id);
    if (!user) return;

    // Only allow relative paths that live inside /uploads/
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;

    io.to(user.room).emit('media', {
      id: `${socket.id}-${Date.now()}`,
      username: user.username,
      url,
      mimetype: String(mimetype),
      timestamp: Date.now(),
    });
  });

  // Typing indicators
  socket.on('typing', () => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('typing', { username: user.username });
  });

  socket.on('stop-typing', () => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('stop-typing', { username: user.username });
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.to(user.room).emit('system', {
        message: `${user.username} left the room`,
        timestamp: Date.now(),
      });
      io.to(user.room).emit('room-users', getRoomUsers(user.room));
    }
  });
});

function getRoomUsers(room) {
  const roomUsers = [];
  for (const [, user] of users) {
    if (user.room === room) roomUsers.push(user.username);
  }
  return roomUsers;
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = { app, server };
