import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import dbConnect from "./src/config/db.config.js";
import { env } from "./src/config/env.config.js";

const port = env.PORT || 5000;

// DB connect
await dbConnect();

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

// server start
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});