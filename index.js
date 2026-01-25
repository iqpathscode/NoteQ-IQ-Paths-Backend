// index.js
import app from './app.js';
import dbConnect from "./src/databaseConfig/database.config.js";
import { env } from "./src/databaseConfig/env.js";

const port = env.PORT || 5000;

// DB connect
await dbConnect();

// server start
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
