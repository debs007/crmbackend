const SaleModel = require("../models/Sale");
const RegisteruserModal = require("../models/User");
const mongoose = require("mongoose");
const { triggerSoftRefresh } = require("../utils/socket");

// Create a new sale and associate with user
exports.createSale = async (req, res) => {
  const userId = req.user.userId;
  try {
    const { name, email, phone, calldate, domainName, buget, country, address, comments } = req.body;
    const newSales = new SaleModel({
      name,
      email,
      phone,
      calldate,
      domainName,
      buget,
      country,
      address,
      comments,
      user_id: userId
    });


    await newSales.save();
    await triggerSoftRefresh("Sale_Employee");


    res.send("Transfer created and associated with user");
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get sales associated with a user (populate)
exports.getSalesByUser = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.params.id);

    const data = await RegisteruserModal.aggregate([
      { $match: { _id: userId } },
      {
        $lookup: {
          from: "sales",
          localField: "_id",
          foreignField: "user_id",
          as: "sales",
        },
      },
    ]);

    res.status(200).json(data[0] || {});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get all sales
exports.getAllSales = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;  // Default to page 1
    const limit = parseInt(req.query.limit) || 10; // Default limit is 10
    const skip = (page - 1) * limit;

    // Get total count (for frontend pagination info)
    const totalSales = await SaleModel.countDocuments();

    const data = await SaleModel.find().skip(skip)
      .limit(limit).sort({ createdAt: -1 });
    res.json({
      page,
      limit,
      totalPages: Math.ceil(totalSales / limit),
      totalSales,
      data,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get a specific sale by ID
exports.getSaleById = async (req, res) => {
  try {
    const user_id = req.user.userId
    const page = parseInt(req.query.page) || 1;  // Default to page 1
    const limit = parseInt(req.query.limit) || 10; // Default limit is 10
    const skip = (page - 1) * limit;

    // Get total count (for frontend pagination info)
    const totalSales = await SaleModel.countDocuments({ user_id });

    const data = await SaleModel.find({ user_id }).skip(skip).limit(limit).sort({ createdAt: -1 });
    res.json({
      page,
      limit,
      totalPages: Math.ceil(totalSales / limit),
      totalSales,
      data,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update a sale by ID
exports.updateSale = async (req, res) => {
  try {
    const updatedSale = await SaleModel.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (!updatedSale) return res.status(404).json({ error: "Sale not found" });
    await triggerSoftRefresh("Sale_Employee");
    res.json({ message: "Sale updated successfully", data: updatedSale });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Delete a sale by ID
exports.deleteSale = async (req, res) => {
  try {
    const deletedSale = await SaleModel.findByIdAndDelete(req.params.id);

    if (!deletedSale) return res.status(404).json({ error: "Sale not found" });
    await triggerSoftRefresh("Sale_Employee");
    res.json({ message: "Sale deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.searchSales = async (req, res) => {
  try {
    const { email, phone, domainName, page = 1, limit = 10 } = req.query;
    const query = {};

    if (email) query.email = { $regex: email, $options: "i" };
    if (phone) query.phone = { $regex: phone, $options: "i" };
    if (domainName) query.domainName = { $regex: domainName, $options: "i" };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch matching sales with pagination
    const data = await SaleModel.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    // Count total documents matching the query
    const totalCount = await SaleModel.countDocuments(query);

    res.status(200).json({
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      data,
    });
  } catch (error) {
    console.error("Error searching sales:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
