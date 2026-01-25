// app.js
import express from "express";
import authRoutes from './src/routes/auth.routes.js';

const app = express();

// middleware
app.use(express.json());

// routes
app.use('/api/auth', authRoutes);

app.get('/test', (req, res) => {
  res.send('API working');
});

app.get("/", (req, res) => {
  res.send("NoteQ is here live !!");
});

export default app;
