const dbPromise = require("../DbConnection");
const logger = require("../logger/logger");

exports.insertPromptsController = async (req, res) => {
  const { prompts } = req.body;
  console.log("prompts", prompts);
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    logger.warn("Invalid data format received for insert operation.");
    return res
      .status(400)
      .json({ error: "Invalid data format. Expected an array of prompts." });
  }

  let connection;
  try {
    const pool = await dbPromise;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const promptData of prompts) {
      const { prompt, db_column, column_type, parser_id } = promptData;

      if (!prompt || !db_column || !column_type || !parser_id) {
        logger.warn("Missing mandatory fields in insert request", {
          requestData: promptData,
        });
        throw new Error("Missing mandatory fields.");
      }

      const query = `
        INSERT INTO llm_parser_prompt
        (id, prompt, db_column, column_type, parser_id, date_created, date_updated)
        VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
      `;

      await connection.query(query, [
        prompt,
        db_column,
        column_type,
        parser_id,
      ]);
    }

    await connection.commit();
    logger.info(`Successfully inserted ${prompts.length} prompts.`);

    res.status(200).json({ message: "Data inserted successfully." });
  } catch (error) {
    if (connection) await connection.rollback();

    logger.error("Error during insert operation", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ error: error.message || "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Create parser in `parser_config`
exports.createParserController = async (req, res) => {
  try {
    const pool = await dbPromise;
    const connection = await pool.getConnection();

    const orgId = process.env.ORG_ID?.trim();
    const { parserName, databaseTableName, dbTableFileNameColumn } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_ ]+$/;

    if (!parserName || !validNameRegex.test(parserName)) {
      logger.warn("Invalid parser name received in request.", { parserName });
      return res.status(400).json({ message: "Invalid parser name." });
    }

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

    const query = `
      INSERT INTO parser_config
      (id, org_id, name, config, parser_type, sample_file, dynamic_parser,
       dynamic_parser_vendor_text, dynamic_parser_vendor_config, dynamic_filename_match_text,
       dynamic_parser_excel_cell_matching_text, dynamic_parser_excel_cell_address, dynamic_parser_excel_sheet_no,
       azure_document_output, azure_output_updated_at, status, date_created, date_updated)
      VALUES (NULL, ?, ?, ?, 'llm-parser', '', 0, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'Active', NOW(), NOW());
    `;

    const [result] = await connection.execute(query, [
      orgId,
      parserName,
      configJSON,
    ]);

    connection.release();

    if (result.affectedRows > 0) {
      logger.info("Parser created successfully", {
        parserId: result.insertId,
        parserName,
        orgId,
      });

      return res.status(201).json({
        message: "Parser created successfully!",
        parserId: result.insertId,
      });
    } else {
      logger.error("Failed to create parser", { parserName, orgId });
      return res.status(400).json({ message: "Failed to create parser" });
    }
  } catch (error) {
    logger.error("Error creating parser", {
      error: error.message,
      stack: error.stack,
    });

    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Onboard template into `llm_template_list`
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
      (id, template_name, template_matching_text, template_prompt, parser_id, date_created, date_updated)
      VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
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

const allowedTables = [
  "llm_parser_prompt",
  "parser_config",
  "llm_template_list",
];

exports.getAllTablesInformation = async (req, res) => {
  let connection;
  const { table, page = 1, limit = 10 } = req.query;

  try {
    const startTime = Date.now(); // ⏳ Track execution time

    if (!table) {
      logger.warn("❗Table name is missing in request query.");
      return res
        .status(400)
        .json({ status: 400, message: "Table name is required." });
    }

    if (!allowedTables.includes(table)) {
      logger.warn(`❗Invalid table name requested: ${table}`);
      return res
        .status(400)
        .json({ status: 400, message: "Invalid table name." });
    }

    const parsedLimit = Math.max(1, parseInt(limit)) || 10; // ✅ Prevent invalid limit
    const parsedPage = Math.max(1, parseInt(page)) || 1; // ✅ Prevent invalid page
    const offset = (parsedPage - 1) * parsedLimit;

    const pool = await dbPromise;
    connection = await pool.getConnection();

    const [[{ totalRecords }]] = await connection.query(
      `SELECT COUNT(*) AS totalRecords FROM ??`,
      [table]
    );

    // ✅ Fetch paginated data
    const [tableData] = await connection.query(
      `SELECT * FROM ?? LIMIT ? OFFSET ?`,
      [table, parsedLimit, offset]
    );

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ ${table}: Fetched ${tableData.length} records, Page: ${parsedPage}, Limit: ${parsedLimit} (Execution Time: ${executionTime}ms)`
    );

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
    logger.error(`❌ Error fetching table data: ${error.message}`);
    res.status(500).json({
      status: 500,
      error: "Database Error",
      message:
        error.message || "Something went wrong while fetching table data.",
    });
  } finally {
    if (connection) connection.release(); // ✅ Always release DB connection
  }
};

// exports.getAllTablesInformation = async (req, res) => {
//   let connection;
//   try {
//     const pool = await dbPromise;
//     connection = await pool.getConnection();

//     const [parserPrompts] = await connection.query(
//       "SELECT id, prompt, db_column, column_type, parser_id, date_created, date_updated FROM llm_parser_prompt"
//     );

//     const [parserConfigs] = await connection.query(
//       "SELECT id, org_id, name, config, status, date_created, date_updated FROM parser_config"
//     );

//     const [templateList] = await connection.query(
//       "SELECT id, template_name, template_matching_text, template_prompt, parser_id, date_created, date_updated FROM llm_template_list"
//     );

//     res.status(200).json({
//       status: 200,
//       message: "Tables fetched successfully",
//       data: {
//         llm_parser_prompt: parserPrompts,
//         parser_config: parserConfigs,
//         llm_template_list: templateList,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching table data:", error.message);

//     const statusCode = error.code === "ER_BAD_DB_ERROR" ? 400 : 500;

//     res.status(statusCode).json({
//       status: statusCode,
//       error: "Database Error",
//       message:
//         error.message || "Something went wrong while fetching table data.",
//     });
//   } finally {
//     if (connection) connection.release(); // Always release connection
//   }
// };
