const mongoose = require("mongoose");

module.exports = async function connection (){
  try{

    await mongoose.connect(process.env.MONGO_URI).then(() => {
      console.log("Connection Successful.");
    })
  }catch(e){
    console.log("Connection UnSuccessful.");
    console.log(e);
  }
}

