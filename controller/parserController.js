const Db = require("../DbConnection");

//playground-tab create-parser
exports.insertPromptsController = async (req, res) => {
  const { prompts } = req.body;

  // Validate if the request body contains the expected structure
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid data format. Expected an array of prompts." });
  }

  let connection;
  try {
    // Await Db promise to get the pool
    const pool = await Db;

    connection = await pool.getConnection(); // Now `pool.getConnection()` works
    await connection.beginTransaction(); // Start a transaction to ensure atomicity

    for (const promptData of prompts) {
      const { prompt, db_column, column_type, parser_id } = promptData;

      // Validate required fields before proceeding
      if (!prompt || !db_column || !column_type || !parser_id) {
        throw new Error(
          "Mandatory fields (prompt, db_column, column_type, parser_id) are missing."
        );
      }

      // SQL query to insert the prompt data
      const query = `
        INSERT INTO llm_parser_prompt 
        (id, prompt, db_column, column_type, parser_id, date_created, date_updated) 
        VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
      `;

      // Execute the query
      await connection.query(query, [
        prompt,
        db_column,
        column_type,
        parser_id,
      ]);
    }

    await connection.commit(); // Commit the transaction if all inserts are successful
    res.status(200).json({ message: "Data inserted successfully." });
  } catch (error) {
    if (connection) await connection.rollback(); // Rollback transaction on failure
    console.error("Error during insert operation:", error); // Log the full error message
    res.status(500).json({ error: error.message || "Internal server error" }); // Return the error message
  } finally {
    if (connection) connection.release(); // Ensure connection is released
  }
};

//vendor-name create-parser (send id back to frontend)
exports.createParserController = async (req, res) => {
  try {
    const db = await Db;
    const orgId = process.env.ORG_ID.trim();

    // Debugging Logs
    console.log("Org ID Before Insert:", orgId);
    console.log("Type of Org ID:", typeof orgId);

    // Extract user input
    const { parserName, databaseTableName, dbTableFileNameColumn } = req.body;

    // Validation Regex (allows letters, numbers, underscores, and spaces)
    const validNameRegex = /^[a-zA-Z0-9_ ]+$/;

    if (!parserName || !validNameRegex.test(parserName)) {
      return res.status(400).json({ message: "Invalid parser name." });
    }
    if (!databaseTableName || !validNameRegex.test(databaseTableName)) {
      return res.status(400).json({ message: "Invalid database table name." });
    }
    if (!dbTableFileNameColumn || !validNameRegex.test(dbTableFileNameColumn)) {
      return res.status(400).json({ message: "Invalid file name column." });
    }

    // Use environment variables for DB connection
    const databaseName = process.env.MYSQL_CLIENT_DB_NAME;
    const databaseUser = process.env.MYSQL_USER;
    const databasePass = process.env.MYSQL_PASSWORD;
    const databaseHost = process.env.MYSQL_HOST;

    // SQL Query
    const query = `
      INSERT INTO \`parser_config\` 
        (\`id\`, \`org_id\`, \`name\`, \`config\`, \`parser_type\`, \`sample_file\`, \`dynamic_parser\`, 
         \`dynamic_parser_vendor_text\`, \`dynamic_parser_vendor_config\`, \`dynamic_filename_match_text\`, 
         \`dynamic_parser_excel_cell_matching_text\`, \`dynamic_parser_excel_cell_address\`, \`dynamic_parser_excel_sheet_no\`, 
         \`azure_document_output\`, \`azure_output_updated_at\`, \`status\`, \`date_created\`, \`date_updated\`) 
      VALUES 
        (NULL, ?, ?, ?, 'llm-parser', '', 0, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'Active', NOW(), NOW());
    `;

    // JSON Config
    const configJSON = JSON.stringify({
      sql: "mysql",
      sqlUrl: `jdbc:mysql://${databaseHost}:3306/${databaseName}`,
      userName: databaseUser,
      password: databasePass,
      database: databaseName,
      table: databaseTableName,
      llmPromptDatabaseTable: "llm_parser_prompt",
      show_query: false,
      fileNameColumn: dbTableFileNameColumn,
    });

    // Debugging logs
    console.log("Executing Query:", query);
    console.log("Values:", [orgId, parserName, configJSON]);

    // Execute the query
    const [result] = await db.execute(query, [orgId, parserName, configJSON]);

    if (result.affectedRows > 0) {
      return res.status(201).json({
        message: "Parser created successfully!",
        parserId: result.insertId,
      });
    } else {
      return res.status(400).json({ message: "Failed to create parser" });
    }
  } catch (error) {
    console.error("Error creating parser:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

//vendor-name onboard-template button
exports.onBoardTemplateController = async (req, res) => {
  try {
    const db = await Db;
    const { parserId, templateName, textToMatchInTemplate, template_prompt } =
      req.body;

    if (!parserId || !templateName || !textToMatchInTemplate) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if the parserId already exists
    const checkQuery = `SELECT id FROM llm_template_list WHERE parser_id = ? LIMIT 1`;
    const [existingTemplates] = await db.execute(checkQuery, [parserId]);

    if (existingTemplates.length > 0) {
      return res.status(409).json({
        status: 409,
        error: "Conflict",
        message: "Parser ID already exists. Duplicate entries are not allowed.",
      });
    }

    // ✅ Corrected: Insert template_prompt from req.body instead of NULL
    const insertQuery = `
      INSERT INTO llm_template_list 
      (id, template_name, template_matching_text, template_prompt, parser_id, date_created, date_updated) 
      VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
    `;
    const values = [
      templateName,
      textToMatchInTemplate,
      template_prompt,
      parserId,
    ];

    const [result] = await db.execute(insertQuery, values);

    if (result.affectedRows > 0) {
      return res.status(201).json({
        status: 201,
        message: "Template onboarded successfully!",
        templateId: result.insertId,
      });
    } else {
      return res.status(400).json({
        status: 400,
        error: "Bad Request",
        message: "Failed to add template.",
      });
    }
  } catch (error) {
    console.error("Error adding template:", error.message);

    return res.status(500).json({
      status: 500,
      error: "Internal Server Error",
      message: "Something went wrong on the server.",
    });
  }
};
