const express = require("express");
const parserRoutes = require("./routes/parserRoutes");
const app = express();
const cors = require("cors");
require("dotenv").config();

const PORT = 5000;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

app.use("/", parserRoutes);

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT} `);
});
