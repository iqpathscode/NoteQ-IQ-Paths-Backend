// app.js
import express from "express";
import authRoutes from './src/routes/auth.routes.js';
import cors from 'cors';
const app = express();

// middleware
app.use(cors());
app.use(express.json({limit: '16kb'}));
app.use(express.urlencoded({ extended: true }));



// routes
app.use('/api/auth', authRoutes);

app.get('/test', (req, res) => {
  res.send('API working');
});

app.get("/", (req, res) => {
  res.send("NoteQ is here live !!");
});

export default app;
