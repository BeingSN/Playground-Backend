const dbPromise = require("../DbConnection");
const logger = require("../logger/logger");

const allowedTables = [
  "llm_parser_prompt",
  "parser_config",
  "llm_template_list",
  "browser_prompts",
];

exports.insertPromptsController = async (req, res) => {
  const { prompts } = req.body;

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({
      error: "Invalid data format. Expected a non-empty array of prompts.",
    });
  }

  let connection;
  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const insertValues = [];
    for (const promptData of prompts) {
      const {
        prompt,
        db_column,
        column_type,
        parser_id,
        value_type,
        mandatory_value,
        prompt_order,
        name,
      } = promptData;

      if (
        !prompt ||
        !db_column ||
        !column_type ||
        !parser_id ||
        !value_type ||
        !mandatory_value ||
        !prompt_order
      ) {
        logger.warn("Missing mandatory fields in insert request", {
          requestData: promptData,
        });
        throw new Error("Missing mandatory fields.");
      }

      insertValues.push([
        prompt,
        db_column,
        column_type,
        parser_id,
        value_type,
        mandatory_value,
        prompt_order,
        name || null,
        new Date(), // date_created
        new Date(), // date_updated
      ]);
    }

    const query = `
      INSERT INTO llm_parser_prompt (
        prompt, db_column, column_type, parser_id,
        value_type, mandatory_value, prompt_order,
        name, date_created, date_updated
      )
      VALUES ?
    `;

    await connection.query(query, [insertValues]);

    await connection.commit();
    logger.info(
      `✅ Successfully inserted ${prompts.length} prompts (bulk insert).`
    );
    res.status(200).json({ message: "Data inserted successfully." });
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error("❌ Error during insert operation", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Create parser in `parser_config`
exports.createParserController = async (req, res) => {
  try {
    /* ----------------------------------------------------------
       1.  Get a pooled connection
    ---------------------------------------------------------- */
    const pool = await dbPromise;
    const connection = await pool.getConnection();

    /* ----------------------------------------------------------
       2.  Read / validate input
    ---------------------------------------------------------- */
    const orgId = process.env.ORG_ID?.trim();
    const {
      parserName,
      databaseTableName,
      dbTableFileNameColumn,
      selectedService, // ← NEW (comes from FE)
    } = req.body;

    const validNameRegex = /^[a-zA-Z0-9_ ]+$/;

    if (!parserName || !validNameRegex.test(parserName)) {
      logger.warn("Invalid parser name received in request.", { parserName });
      return res.status(400).json({ message: "Invalid parser name." });
    }

    if (!selectedService || typeof selectedService !== "string") {
      logger.warn("Invalid selectedService received in request.", {
        selectedService,
      });
      return res.status(400).json({ message: "Invalid selectedService." });
    }

    /* ----------------------------------------------------------
       3.  Build the JSON config that goes into `config` column
    ---------------------------------------------------------- */
    const configJSON = JSON.stringify({
      sql: "mysql",
      sqlUrl: `jdbc:mysql://${process.env.PARSER_CONFIG_MYSQL_HOST}:3306/${process.env.MYSQL_CLIENT_DB_NAME}`,
      userName: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_CLIENT_DB_NAME,
      table: databaseTableName,
      llmPromptDatabaseTable: "llm_parser_prompt",
      show_query: false,
      fileNameColumn: dbTableFileNameColumn,
    });

    /* ----------------------------------------------------------
       4.  Insert into parser_config
    ---------------------------------------------------------- */
    const query = `
      INSERT INTO parser_config
        (id, org_id, name, config, parser_type, service_type, sample_file, dynamic_parser,
         dynamic_parser_vendor_text, dynamic_parser_vendor_config, dynamic_filename_match_text,
         dynamic_parser_excel_cell_matching_text, dynamic_parser_excel_cell_address, dynamic_parser_excel_sheet_no,
         azure_document_output, azure_output_updated_at, status, date_created, date_updated)
      VALUES
        (NULL, ?, ?, ?, 'llm-parser', ?, '', 0,           -- service_type placeholder (?)
         NULL, NULL, NULL, NULL, NULL, NULL, '', NULL,
         'Active', NOW(), NOW());
    `;

    const [result] = await connection.execute(query, [
      orgId, // ?
      parserName, // ?
      configJSON, // ?
      selectedService, // ?  ← service_type
    ]);

    /* ----------------------------------------------------------
       5.  Respond to client
    ---------------------------------------------------------- */
    if (result.affectedRows > 0) {
      logger.info("Parser created successfully", {
        parserId: result.insertId,
        parserName,
        orgId,
        selectedService,
      });

      return res.status(201).json({
        message: "Parser created successfully!",
        parserId: result.insertId,
      });
    }

    logger.error("Failed to create parser", { parserName, orgId });
    return res.status(400).json({ message: "Failed to create parser" });
  } catch (error) {
    logger.error("Error creating parser", {
      error: error.message,
      stack: error.stack,
    });
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  } finally {
    // ensure connection always released
    try {
      if (connection) connection.release();
    } catch (_) {}
  }
};

exports.onBoardTemplateController = async (req, res) => {
  try {
    const pool = await dbPromise;
    const connection = await pool.getConnection();

    const { parserId, templateName, textToMatchInTemplate, template_prompt } =
      req.body;

    if (!parserId || !templateName || !textToMatchInTemplate) {
      logger.warn("Missing required fields in onboarding request", {
        parserId,
        templateName,
        textToMatchInTemplate,
      });

      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if parser_id already exists
    const checkQuery = `SELECT id FROM llm_template_list WHERE parser_id = ? LIMIT 1`;
    const [existingTemplates] = await connection.execute(checkQuery, [
      parserId,
    ]);

    if (existingTemplates.length > 0) {
      connection.release();
      logger.warn("Duplicate parser ID detected", { parserId });

      return res.status(409).json({
        status: 409,
        error: "Conflict",
        message: "Parser ID already exists. Duplicate entries are not allowed.",
      });
    }

    const insertQuery = `
      INSERT INTO llm_template_list
      (template_name, template_matching_text, template_prompt, parser_id, date_created, date_updated)
      VALUES (?, ?, ?, ?, NOW(), NOW());
    `;

    const values = [
      templateName,
      textToMatchInTemplate,
      template_prompt,
      parserId,
    ];

    const [result] = await connection.execute(insertQuery, values);
    connection.release();

    if (result.affectedRows > 0) {
      logger.info("Template onboarded successfully", {
        templateId: result.insertId,
        parserId,
        templateName,
      });

      return res.status(201).json({
        status: 201,
        message: "Template onboarded successfully!",
        templateId: result.insertId,
      });
    } else {
      logger.error("Failed to onboard template", { parserId, templateName });

      return res.status(400).json({
        status: 400,
        error: "Bad Request",
        message: "Failed to add template.",
      });
    }
  } catch (error) {
    logger.error("Error onboarding template", {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: 500,
      error: "Internal Server Error",
      message: "Something went wrong on the server.",
    });
  }
};

//PG-Stage Db Information
exports.getAllTablesInformation = async (req, res) => {
  let connection;
  const { table, page = 1, limit = 10, search = "" } = req.query;

  try {
    const startTime = Date.now();

    // Validate `table` parameter
    if (!table) {
      logger.warn("❗Table name is missing in request query.");
      return res
        .status(400)
        .json({ status: 400, message: "Table name is required." });
    }

    // Check if the table is allowed
    if (!allowedTables.includes(table)) {
      logger.warn(`❗Invalid table name requested: ${table}`);
      return res
        .status(400)
        .json({ status: 400, message: "Invalid table name." });
    }

    const parsedLimit = Math.max(1, parseInt(limit)) || 10;
    const parsedPage = Math.max(1, parseInt(page)) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const pool = await dbPromise;
    connection = await pool.getConnection();

    // Retrieve column names for the table
    const [columns] = await connection.query(`SHOW COLUMNS FROM ??`, [table]);
    const columnNames = columns.map((col) => col.Field);

    logger.info(`✅ Retrieved columns for table ${table}:`, columnNames);

    // Construct dynamic search query
    let searchQuery = "";
    const searchParams = [];

    if (search.trim() && columnNames.length > 0) {
      // Special logic for `llm_parser_prompt` and `llm_template_list` with digits
      if (
        ["llm_parser_prompt", "llm_template_list"].includes(table) &&
        /^\d+$/.test(search.trim()) // Check for numbers (single or multiple digits)
      ) {
        searchQuery = ` AND parser_id = ?`;
        searchParams.push(search.trim()); // Exact match for parser_id
      } else {
        // Default search logic (applies to all other cases)
        searchQuery = ` AND (${columnNames
          .map(() => `?? LIKE ?`)
          .join(" OR ")})`;
        columnNames.forEach((col) => {
          searchParams.push(col); // Column name
          searchParams.push(`%${search.trim()}%`); // Search value with wildcards
        });
      }
    }

    // Count total records matching the search filter
    const [[{ totalRecords }]] = await connection.query(
      `SELECT COUNT(*) AS totalRecords FROM ?? WHERE 1=1 ${searchQuery}`,
      [table, ...searchParams]
    );

    // If no matching records are found, return an empty array
    if (totalRecords === 0) {
      logger.info(
        `⚠️ No records found for table: ${table} with search filter: ${search}`
      );
      return res.status(200).json({
        status: 200,
        message: `No data found for table: ${table}`,
        data: [],
        pagination: {
          table,
          totalRecords: 0,
          currentPage: 0,
          totalPages: 0,
        },
      });
    }

    // Fetch paginated data based on the filter
    const [tableData] = await connection.query(
      `SELECT * FROM ?? WHERE 1=1 ${searchQuery} LIMIT ? OFFSET ?`,
      [table, ...searchParams, parsedLimit, offset]
    );

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ ${table}: Fetched ${tableData.length} records (Execution Time: ${executionTime}ms)`
    );

    // Return the response with data
    res.status(200).json({
      status: 200,
      message: `Data fetched successfully from ${table}`,
      data: tableData,
      pagination: {
        table,
        totalRecords,
        currentPage: parsedPage,
        totalPages: Math.ceil(totalRecords / parsedLimit),
      },
    });
  } catch (error) {
    logger.error(`❌ Error: ${error.message}`);
    res.status(500).json({
      status: 500,
      error: "Database Error",
      message:
        error.message || "Something went wrong while fetching table data.",
    });
  } finally {
    if (connection) connection.release();
  }
};

//delete data from stage db
exports.deleteStageDbRecordController = async (req, res) => {
  const { tableName, id } = req.body;
  let connection;

  if (!tableName || !id) {
    return res.status(400).json({ message: "Missing table or id." });
  }

  if (!allowedTables.includes(tableName)) {
    return res.status(400).json({ message: "Invalid table name." });
  }

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    // Get primary key column name
    const [pkResult] = await connection.query(
      `SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'`,
      [tableName]
    );

    const primaryKey = pkResult[0]?.Column_name;
    if (!primaryKey) {
      return res
        .status(400)
        .json({ message: `Primary key not found for table ${tableName}` });
    }

    const [result] = await connection.query(`DELETE FROM ?? WHERE ?? = ?`, [
      tableName,
      primaryKey,
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Record not found." });
    }

    logger.info(
      `✅ Deleted record from ${tableName} where ${primaryKey} = ${id}`
    );
    res.status(200).json({ message: "Record deleted successfully." });
  } catch (error) {
    logger.error("❌ Delete Error:", error.message);
    res.status(500).json({ message: "Delete failed.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

//update stagedb data
exports.updateStageDbRecordController = async (req, res) => {
  const { tableName, id, updates } = req.body;
  let connection;

  if (!tableName || !id || !updates || typeof updates !== "object") {
    return res
      .status(400)
      .json({ message: "Missing table, id, or update values." });
  }

  if (!allowedTables.includes(tableName)) {
    return res.status(400).json({ message: "Invalid table name." });
  }

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    // Get primary key column name
    const [pkResult] = await connection.query(
      `SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'`,
      [tableName]
    );

    const primaryKey = pkResult[0]?.Column_name;
    if (!primaryKey) {
      return res
        .status(400)
        .json({ message: `Primary key not found for table ${tableName}` });
    }

    // Build SET clause dynamically
    const setClause = Object.keys(updates)
      .map(() => "?? = ?")
      .join(", ");
    const values = [];

    Object.entries(updates).forEach(([key, value]) => {
      values.push(key, value);
    });

    values.push(primaryKey, id);

    const [result] = await connection.query(
      `UPDATE ?? SET ${setClause} WHERE ?? = ?`,
      [tableName, ...values]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Record not found or not changed." });
    }

    logger.info(
      `✅ Updated record in ${tableName} where ${primaryKey} = ${id}`
    );
    res.status(200).json({ message: "Record updated successfully." });
  } catch (error) {
    logger.error("❌ Update Error:", error.message);
    res.status(500).json({ message: "Update failed.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

//insert Browser-Prompts
exports.insertBrowserPromptsController = async (req, res) => {
  const prompts = req.body.prompts;
  let connection;

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res
      .status(400)
      .json({ message: "Payload must contain an array of prompts." });
  }

  const values = [];

  for (const item of prompts) {
    const { prompt, prompt_order, use_case } = item;

    if (!prompt || prompt_order === undefined || !use_case) {
      return res.status(400).json({
        message:
          "Each prompt must have 'prompt', 'prompt_order', and 'use_case'.",
      });
    }

    if (typeof prompt_order !== "number") {
      return res.status(400).json({
        message: "'prompt_order' must be a number.",
      });
    }

    values.push([prompt, prompt_order, use_case]);
  }

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    const [result] = await connection.query(
      `INSERT INTO browser_prompts (prompt, prompt_order, use_case) VALUES ?`,
      [values]
    );

    logger.info(`✅ Inserted ${result.affectedRows} browser prompt(s)`);

    res.status(201).json({
      message: `${result.affectedRows} browser prompt(s) inserted successfully.`,
    });
  } catch (error) {
    logger.error("❌ Batch Insert Error:", error.message);
    res.status(500).json({ message: "Insert failed.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

//get table prompts data
exports.getBrowserPromptsController = async (req, res) => {
  let connection;

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    const [rows] = await connection.query("SELECT * FROM browser_prompts");

    res.status(200).json({
      success: true,
      data: rows,
      message: "Data fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching browser prompts:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
};

//update browser prompts
exports.updateBrowserPromptsController = async (req, res) => {
  let connection;

  const { id } = req.params;
  const { prompt, priority } = req.body;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing 'id' in query params." });
  }

  if (!prompt || !priority) {
    return res.status(400).json({
      success: false,
      message: "Missing 'prompt' or 'priority' in body.",
    });
  }

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    const [result] = await connection.query(
      "UPDATE browser_prompts SET prompt = ?, priority = ? WHERE id = ?",
      [prompt, priority, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Prompt not found or no change made.",
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Prompt updated successfully." });
  } catch (error) {
    console.error("Error updating browser prompt:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
};

//delete browser prompts
exports.deleteBrowserPromptsController = async (req, res) => {
  let connection;

  const { id } = req.params;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing 'id' in query params." });
  }

  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();

    const [result] = await connection.query(
      "DELETE FROM browser_prompts WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Prompt not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Prompt deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting browser prompt:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
};
