import Notesheet from "../models/notes/notesheet.model.js";


// ---------------- GET RECEIVED NOTESHEETS ----------------

export const getReceivedNotesheets = async (req, res) => {
  try {

    console.log("Received notesheet API called");
    console.log("req.user:", req.user);

    const empId = req.user.emp_id;

    console.log("Searching for emp_id:", empId);

    const notesheets = await Notesheet.find({
      forward_to_emp_id: empId,
      status: "PENDING"
    });

    console.log("Notesheets found:", notesheets);

    res.status(200).json({
      success: true,
      count: notesheets.length,
      data: notesheets
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: "Error fetching received notesheets",
      error: error.message
    });

  }
};


// ---------------- APPROVE NOTESHEET ----------------

export const approveNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const userId = req.user.id;

    const notesheet = await Notesheet.findById(noteId);

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    const currentIndex = notesheet.approvalFlow.findIndex(
      (s) => s.approver.toString() === userId && s.status === "pending"
    );

    if (currentIndex === -1) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to approve this notesheet"
      });
    }

    // approve current step
    notesheet.approvalFlow[currentIndex].status = "approved";
    notesheet.approvalFlow[currentIndex].actionDate = new Date();

    // activate next approver
    const nextStep = notesheet.approvalFlow[currentIndex + 1];

    if (nextStep) {
      nextStep.status = "pending";
    } else {
      notesheet.status = "approved"; // final approval
    }

    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Notesheet approved successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error approving notesheet",
      error: error.message
    });
  }
};



// ---------------- REJECT NOTESHEET ----------------

export const rejectNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const userId = req.user.id;

    const notesheet = await Notesheet.findById(noteId);

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    const step = notesheet.approvalFlow.find(
      (s) => s.approver.toString() === userId && s.status === "pending"
    );

    if (!step) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this notesheet"
      });
    }

    step.status = "rejected";
    step.remark = remark;
    step.actionDate = new Date();

    notesheet.status = "rejected";
    notesheet.rejectedBy = userId;
    notesheet.rejectedDate = new Date();

    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Notesheet rejected successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error rejecting notesheet",
      error: error.message
    });
  }
};



// ---------------- SEND QUERY ----------------

export const sendQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { query } = req.body;
    const userId = req.user.id;

    const notesheet = await Notesheet.findById(noteId);

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    const step = notesheet.approvalFlow.find(
      (s) => s.approver.toString() === userId && s.status === "pending"
    );

    if (!step) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to send query"
      });
    }

    step.status = "query";
    step.query = query;
    step.queryDate = new Date();

    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Query sent successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error sending query",
      error: error.message
    });
  }
};



// ---------------- REPLY QUERY ----------------

export const replyQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { reply } = req.body;

    const notesheet = await Notesheet.findById(noteId);

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    const step = notesheet.approvalFlow.find(
      (s) => s.status === "query"
    );

    if (!step) {
      return res.status(400).json({
        success: false,
        message: "No active query found"
      });
    }

    step.reply = reply;
    step.replyDate = new Date();
    step.status = "pending";

    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Query reply submitted successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error replying query",
      error: error.message
    });
  }
};