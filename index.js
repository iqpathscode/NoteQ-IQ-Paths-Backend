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
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  perMessageDeflate: false,
});

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    if (userId) {
      socket.join(`emp_${userId}`);
    }
  });

  socket.on('disconnect', () => {});
});

// Keep-alive timeouts tuned above standard reverse-proxy / LB idle timeouts (60s)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

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