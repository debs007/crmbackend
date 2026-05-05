const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Create a new sale
router.post("/", authMiddleware, saleController.createSale);

// Get a sale by user ID (populate)
router.get("/user/:id", saleController.getSalesByUser);

// Get all sales
router.get("/all", saleController.getAllSales);

// Get a specific sale by ID
router.get("/user",authMiddleware, saleController.getSaleById);

// Update a sale by ID
router.put("/:id", saleController.updateSale);

// Delete a sale by ID
router.delete("/:id", saleController.deleteSale);
router.get("/search",saleController.searchSales);

module.exports = router;
