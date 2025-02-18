// const { clientDbPoolPromise, mainDbPoolPromise } = require("../DbConnection");

// // Insert prompts into `llm_parser_prompt`
// exports.insertPromptsController = async (req, res) => {
//   const { prompts } = req.body;

//   if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
//     return res
//       .status(400)
//       .json({ error: "Invalid data format. Expected an array of prompts." });
//   }

//   let connection;
//   try {
//     const pool = await clientDbPoolPromise; // Ensure pool is initialized
//     connection = await pool.getConnection();
//     await connection.beginTransaction();

//     for (const promptData of prompts) {
//       const { prompt, db_column, column_type, parser_id } = promptData;

//       if (!prompt || !db_column || !column_type || !parser_id) {
//         throw new Error("Missing mandatory fields.");
//       }

//       const query = `
//         INSERT INTO \`${process.env.MYSQL_CLIENT_DB_NAME}\`.llm_parser_prompt
//         (id, prompt, db_column, column_type, parser_id, date_created, date_updated)
//         VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
//       `;

//       await connection.query(query, [
//         prompt,
//         db_column,
//         column_type,
//         parser_id,
//       ]);
//     }

//     await connection.commit();
//     res.status(200).json({ message: "Data inserted successfully." });
//   } catch (error) {
//     if (connection) await connection.rollback();
//     console.error("Error during insert operation:", error);
//     res.status(500).json({ error: error.message || "Internal server error" });
//   } finally {
//     if (connection) connection.release();
//   }
// };

// // Create parser in `parser_config`
// exports.createParserController = async (req, res) => {
//   try {
//     const pool = await mainDbPoolPromise; // Ensure pool is initialized
//     const connection = await pool.getConnection();

//     const orgId = process.env.ORG_ID.trim();
//     const { parserName, databaseTableName, dbTableFileNameColumn } = req.body;
//     const validNameRegex = /^[a-zA-Z0-9_ ]+$/;

//     if (!parserName || !validNameRegex.test(parserName)) {
//       return res.status(400).json({ message: "Invalid parser name." });
//     }

//     const configJSON = JSON.stringify({
//       sql: "mysql",
//       sqlUrl: `jdbc:mysql://${process.env.MYSQL_HOST}:3306/${process.env.MYSQL_CLIENT_DB_NAME}`,
//       userName: process.env.MYSQL_USER,
//       password: process.env.MYSQL_PASSWORD,
//       database: process.env.MYSQL_CLIENT_DB_NAME,
//       table: databaseTableName,
//       llmPromptDatabaseTable: "llm_parser_prompt",
//       show_query: false,
//       fileNameColumn: dbTableFileNameColumn,
//     });

//     const query = `
//       INSERT INTO \`${process.env.MYSQL_DATABASE}\`.parser_config
//       (id, org_id, name, config, parser_type, sample_file, dynamic_parser,
//        dynamic_parser_vendor_text, dynamic_parser_vendor_config, dynamic_filename_match_text,
//        dynamic_parser_excel_cell_matching_text, dynamic_parser_excel_cell_address, dynamic_parser_excel_sheet_no,
//        azure_document_output, azure_output_updated_at, status, date_created, date_updated)
//       VALUES (NULL, ?, ?, ?, 'llm-parser', '', 0, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'Active', NOW(), NOW());
//     `;

//     const [result] = await connection.execute(query, [
//       orgId,
//       parserName,
//       configJSON,
//     ]);

//     connection.release();

//     if (result.affectedRows > 0) {
//       return res.status(201).json({
//         message: "Parser created successfully!",
//         parserId: result.insertId,
//       });
//     } else {
//       return res.status(400).json({ message: "Failed to create parser" });
//     }
//   } catch (error) {
//     console.error("Error creating parser:", error);
//     return res
//       .status(500)
//       .json({ message: "Internal server error", error: error.message });
//   }
// };

// // Onboard template into `llm_template_list`
// exports.onBoardTemplateController = async (req, res) => {
//   try {
//     const pool = await clientDbPoolPromise; // Ensure pool is initialized
//     const connection = await pool.getConnection();

//     const { parserId, templateName, textToMatchInTemplate, template_prompt } =
//       req.body;

//     if (!parserId || !templateName || !textToMatchInTemplate) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     // Check if parser_id already exists
//     const checkQuery = `SELECT id FROM \`${process.env.MYSQL_CLIENT_DB_NAME}\`.llm_template_list WHERE parser_id = ? LIMIT 1`;
//     const [existingTemplates] = await connection.execute(checkQuery, [
//       parserId,
//     ]);

//     if (existingTemplates.length > 0) {
//       connection.release();
//       return res.status(409).json({
//         status: 409,
//         error: "Conflict",
//         message: "Parser ID already exists. Duplicate entries are not allowed.",
//       });
//     }

//     const insertQuery = `
//       INSERT INTO \`${process.env.MYSQL_CLIENT_DB_NAME}\`.llm_template_list
//       (id, template_name, template_matching_text, template_prompt, parser_id, date_created, date_updated)
//       VALUES (NULL, ?, ?, ?, ?, NOW(), NOW());
//     `;
//     const values = [
//       templateName,
//       textToMatchInTemplate,
//       template_prompt,
//       parserId,
//     ];

//     const [result] = await connection.execute(insertQuery, values);
//     connection.release();

//     if (result.affectedRows > 0) {
//       return res.status(201).json({
//         status: 201,
//         message: "Template onboarded successfully!",
//         templateId: result.insertId,
//       });
//     } else {
//       return res.status(400).json({
//         status: 400,
//         error: "Bad Request",
//         message: "Failed to add template.",
//       });
//     }
//   } catch (error) {
//     console.error("Error adding template:", error.message);
//     return res.status(500).json({
//       status: 500,
//       error: "Internal Server Error",
//       message: "Something went wrong on the server.",
//     });
//   }
// };

const dbPromise = require("../DbConnection");

// Insert prompts into `llm_parser_prompt`
exports.insertPromptsController = async (req, res) => {
  const { prompts } = req.body;

  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
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
    res.status(200).json({ message: "Data inserted successfully." });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error during insert operation:", error);
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

    const orgId = process.env.ORG_ID.trim();
    const { parserName, databaseTableName, dbTableFileNameColumn } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_ ]+$/;

    if (!parserName || !validNameRegex.test(parserName)) {
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

// Onboard template into `llm_template_list`
exports.onBoardTemplateController = async (req, res) => {
  try {
    const pool = await dbPromise;
    const connection = await pool.getConnection();

    const { parserId, templateName, textToMatchInTemplate, template_prompt } =
      req.body;

    if (!parserId || !templateName || !textToMatchInTemplate) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if parser_id already exists
    const checkQuery = `SELECT id FROM llm_template_list WHERE parser_id = ? LIMIT 1`;
    const [existingTemplates] = await connection.execute(checkQuery, [
      parserId,
    ]);

    if (existingTemplates.length > 0) {
      connection.release();
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
