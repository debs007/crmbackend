const TransferModel = require("../models/Transfer");
const RegisteruserModal = require("../models/User");
const CallbackModel = require("../models/CallBack");
const SaleModel = require("../models/Sale");
const mongoose = require("mongoose");
const { triggerSoftRefresh } = require("../utils/socket");

// ✅ Create a new transfer
exports.createTransfer = async (req, res) => {
  const userId = req.user.userId;

  try {
    const {
      name,
      email,
      phone,
      calldate,
      domainName,
      buget,
      country,
      address,
      comments,
    } = req.body;
    const newTransfer = new TransferModel({
      name,
      email,
      phone,
      calldate,
      domainName,
      buget,
      country,
      address,
      comments,
      user_id: userId,
    });

    await newTransfer.save();
 await triggerSoftRefresh("Transfer_Employee");
    res.send("Transfer created and associated with user");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

// ✅ Move a transfer to sales
exports.moveTransferToSales = async (req, res) => {
  try {
    const { transfer_id, saleData } = req.body;
    const deletedTransfer = await TransferModel.findByIdAndDelete(transfer_id);

    if (!deletedTransfer) return res.status(404).send("Transfer not found");

    delete saleData._id;
    const newSale = await SaleModel.create(saleData);

    await RegisteruserModal.findByIdAndUpdate(deletedTransfer.user_id, {
      $push: { sale: newSale._id },
    });
 await triggerSoftRefresh("Sale_Employee");
    res.send({
      message: "Transfer deleted and sales record created successfully",
      sale: newSale,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

// ✅ Move a transfer to a callback
exports.moveTransferToCallback = async (req, res) => {
  try {
    const { transfer_id, callbackData } = req.body;
    const deletedTransfer = await TransferModel.findByIdAndDelete(transfer_id);

    if (!deletedTransfer) return res.status(404).send("Transfer not found");

    delete callbackData._id;
    const newCallback = await CallbackModel.create(callbackData);

    await RegisteruserModal.findByIdAndUpdate(deletedTransfer.user_id, {
      $push: { callback: newCallback._id },
    });
 await triggerSoftRefresh("Transfer_Employee");
    res.send({
      message: "Transfer deleted and callback record created successfully",
      callback: newCallback,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

// ✅ Get all transfers for a specific user
exports.getUserTransfers = async (req, res) => {
  try {
    const ID = new mongoose.Types.ObjectId(req.params.id);
    const data = await RegisteruserModal.aggregate([
      { $match: { _id: ID } },
      {
        $lookup: {
          from: "transfers",
          localField: "_id",
          foreignField: "user_id",
          as: "transfer",
        },
      },
    ]);

    res.status(200).json(data[0] || {});
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

// ✅ Get all transfers
exports.getAllTransfers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const data = await TransferModel.find()
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });
    const totalTransfer = await TransferModel.countDocuments();

    res.status(200).json({
      page,
      limit,
      totalPages: Math.ceil(totalTransfer / limit),
      totalTransfer,
      data,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send(error);
  }
};

// ✅ Get a single transfer by ID
exports.getTransferById = async (req, res) => {
  try {
    const user_id = req.user.userId;
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch callbacks only for the logged-in user
    const data = await TransferModel.find({ user_id })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Get total count for pagination
    const totalTransfer = await TransferModel.countDocuments({ user_id });

    res.status(200).json({
      page,
      limit,
      totalPages: Math.ceil(totalTransfer / limit),
      totalTransfer,
      data,
    });
  } catch (error) {
    console.error("Error fetching user callbacks:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update a document by ID
exports.updateTransfer = async (req, res) => {
  const packageId = req.params.id;
  const updateData = req.body;
  try {
    const updatedPackage = await TransferModel.findByIdAndUpdate(
      packageId,
      updateData,
      { new: true }
    );

    if (!updatedPackage) {
      return res.status(404).json({ message: "Package not found" });
    }
 await triggerSoftRefresh("Transfer_Employee");
    res.json({ message: "Package updated successfully", data: updatedPackage });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Delete a document by ID
exports.deleteTransfer = async (req, res) => {
  const packageId = req.params.id;

  try {
    const deletedPackage = await TransferModel.findByIdAndDelete(packageId);

    if (!deletedPackage) {
      return res.status(404).json({ message: "Package not found" });
    }
 await triggerSoftRefresh("Transfer_Employee");
    res.json({ message: "Package deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

exports.searchTransfers = async (req, res) => {
  try {
    const {
      q,
      name,
      email,
      phone,
      domainName,
      scope = "user",
      page = 1,
      limit = 10,
    } = req.query;
    const query = {};

    if (scope !== "all" && req.user?.userId) {
      query.user_id = req.user.userId;
    }

    if (name) query.name = { $regex: escapeRegex(name), $options: "i" };
    if (email) query.email = { $regex: escapeRegex(email), $options: "i" };
    if (phone) query.phone = { $regex: escapeRegex(phone), $options: "i" };
    if (domainName) query.domainName = { $regex: escapeRegex(domainName), $options: "i" };

    if (q && q.trim()) {
      const safeQ = escapeRegex(q.trim());
      const regex = new RegExp(safeQ, "i");
      query.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { domainName: regex },
      ];
    }

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.max(parseInt(limit, 10) || 10, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const data = await TransferModel.find(query)
      .skip(skip)
      .limit(parsedLimit)
      .sort({ createdAt: -1 });

    const totalCount = await TransferModel.countDocuments(query);

    res.status(200).json({
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(totalCount / parsedLimit),
      totalCount,
      data,
    });
  } catch (error) {
    console.error("Error searching transfers:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
