import express from 'express';
import { login } from '../controllers/login/auth.controller.js';
import { signup } from '../controllers/signup/auth.controller.js';
const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);

export default router;
