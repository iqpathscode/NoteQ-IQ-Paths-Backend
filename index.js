import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import dbConnect from "./src/config/db.config.js";
import { autoSeedOnStartup } from "./src/config/autoSeed.js";
import { env } from "./src/config/env.config.js";

const port = env.PORT || 5000;

// http server (socket.io ke liye express app ko wrap karna zaroori hai)
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true
  }
});

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`emp_${userId}`);
    console.log(`🔗 Socket ${socket.id} joined room: emp_${userId}`); // debug ke liye rakh lo abhi
  });

  socket.on('disconnect', () => {});
});

// controllers me `req.app.get('io')` se access karne ke liye
app.set('io', io);

// Server start immediately so LiteSpeed/Passenger binds socket without timeout
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// DB connect & Auto-seed (Non-blocking without top-level await for LiteSpeed compatibility)
const initApp = async () => {
  try {
    await dbConnect();
    await autoSeedOnStartup();
  } catch (err) {
    console.error("Failed to initialize database/autoSeed:", err);
  }
};

initApp();