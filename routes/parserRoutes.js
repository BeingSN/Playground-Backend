const express = require("express");
const router = express.Router();
const parserController = require("../controller/parserController");

//for playground
router.post("/insert-prompts", parserController.insertPromptsController);

router.post("/create-parser", parserController.createParserController);

router.post("/onboard-template", parserController.onBoardTemplateController);

router.get("/get-all-tables-info", parserController.getAllTablesInformation);

router.delete(
  "/delete-stagedbData",
  parserController.deleteStageDbRecordController
);

router.put(
  "/update-stagedbData",
  parserController.updateStageDbRecordController
);

router.post(
  "/insert-browserPrompts",
  parserController.insertBrowserPromptsController
);

router.get("/get-browserPrompts", parserController.getBrowserPromptsController);

router.put(
  "/update-browserPrompts/:id",
  parserController.updateBrowserPromptsController
);

router.delete(
  "/delete-browserPrompts/:id",
  parserController.deleteBrowserPromptsController
);

module.exports = router;
