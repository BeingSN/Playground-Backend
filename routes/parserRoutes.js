const express = require("express");
const router = express.Router();
const parserController = require("../controller/parserController");

//for playground
router.post("/insert-prompts", parserController.insertPromptsController);

router.post("/create-parser", parserController.createParserController);

router.post("/onboard-template", parserController.onBoardTemplateController);

module.exports = router;
