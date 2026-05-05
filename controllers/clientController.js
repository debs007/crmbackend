const Client = require("../models/Client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const generateToken = (userId, name) => {
  return jwt.sign({ userId, name }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

exports.signUp = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const client = new Client({ name, email, password });
    await client.save();
    res.status(201).json({ message: "client account created" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "User creation failed", error: error.message });
    console.log(error);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await Client.findOne({ email });
    if (!user) {
      res.status(401).json({ message: "invalid credential" });
    }
    const match = await bcrypt.compare(password, user.password);
    const token = generateToken(user._id, user.name);
    res.status(200).json({ message: "login sucessful", token });
  } catch (error) {
    res.status(200).json({ message: "login failed", error: error.message });
  }
};
