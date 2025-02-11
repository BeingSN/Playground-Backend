const mysql = require("mysql2/promise");
require("dotenv").config(); // Load .env variables

const createPoolWithRetry = async (retries = 5, delay = 5000) => {
  let pool;
  while (retries) {
    try {
      pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_STAGE_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });

      // Test connection
      const connection = await pool.getConnection();
      console.log("✅ Database connected successfully!");
      connection.release();
      return pool;
    } catch (error) {
      console.log(
        `❌ Database connection failed: ${error.message}. Retrying in ${
          delay / 1000
        } seconds...`
      );
      retries--;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Could not connect to the database after multiple attempts.");
};

// Export a promise that resolves with the pool
const dbPromise = createPoolWithRetry();

module.exports = dbPromise;

// const mysql = require("mysql2/promise");
// require("dotenv").config();

// const createPoolWithRetry = async (dbName, retries = 5, delay = 5000) => {
//   let pool;
//   while (retries > 0) {
//     try {
//       pool = mysql.createPool({
//         host: process.env.MYSQL_HOST,
//         user: process.env.MYSQL_USER,
//         password: process.env.MYSQL_PASSWORD,
//         database: dbName,
//         waitForConnections: true,
//         connectionLimit: 10,
//         queueLimit: 0,
//       });

//       // Test connection
//       const connection = await pool.getConnection();
//       console.log(`✅ Connected to database: ${dbName}`);
//       connection.release();
//       return pool;
//     } catch (error) {
//       console.error(
//         `❌ Connection failed to ${dbName}: ${error.message}. Retrying in ${
//           delay / 1000
//         } seconds...`
//       );
//       retries--;
//       await new Promise((resolve) => setTimeout(resolve, delay));
//     }
//   }

//   throw new Error(
//     `❌ Could not connect to database ${dbName} after multiple attempts.`
//   );
// };

// // Initialize pools once and export as resolved promises
// const clientDbPoolPromise = createPoolWithRetry(
//   process.env.MYSQL_CLIENT_DB_NAME
// );
// const mainDbPoolPromise = createPoolWithRetry(process.env.MYSQL_DATABASE);

// module.exports = { clientDbPoolPromise, mainDbPoolPromise };
