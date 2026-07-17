// index.js
import app from './app.js';
import dbConnect from "./src/config/db.config.js";
import { env } from "./src/config/env.config.js";

const port = env.PORT || 5000;

// DB connect
await dbConnect();

// server start
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
