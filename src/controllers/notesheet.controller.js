import Notesheet from "../models/notes/notesheet.model.js";
import Employee from "../models/user/employee.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js"; // import added

export const notesheetViewPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    // Sender lookup
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "sender"
      }
    },
    // Receiver lookup
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "forward_to",
        foreignField: "emp_id",
        as: "receiver"
      }
    },
    //  Approval chain lookup
    {
      $lookup: {
        from: NotesheetFlow.collection.name,
        localField: "note_id",
        foreignField: "note_id",
        as: "approvalChain"
      }
    },
    {
      $addFields: {
        submittedBy: { $arrayElemAt: ["$sender.emp_name", 0] },
        submittedTo: { $arrayElemAt: ["$receiver.emp_name", 0] }
      }
    },
    {
      $project: {
        _id: 0,
        id: { $toString: "$note_id" },
        note_id: 1,
        title: "$subject",
        date: "$createdAt",
        status: 1,
        description: 1,
        attachment: "$attachment",
        submittedBy: 1,
        submittedTo: 1,
        category: { $literal: null },
        priority: { $literal: null },
        emp_id: 1,
        dept_id: 1,
        forward_to: 1,
        approvalChain: 1 //  new field
      }
    }
  );

  return pipeline;
};

export const getNotesheetsForEmployee = async (req, res) => {
  try {
    const empId = Number(req.query.empId);
    const status = req.query.status; // optional filter

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId query param is required"
      });
    }

    const matchStage = { emp_id: empId };
    if (status) matchStage.status = status; //  filter by status

    const notesheets = await Notesheet.aggregate(
      notesheetViewPipeline({ $match: matchStage })
    );

    return res.status(200).json({
      success: true,
      message: "Notesheets fetched successfully",
      data: notesheets
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


export const getNotesheetById = async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);

    if (!noteId) {
      return res.status(400).json({
        success: false,
        message: "noteId is required"
      });
    }

    const results = await Notesheet.aggregate(
      notesheetViewPipeline({ $match: { note_id: noteId } })
    );

    const notesheet = results[0];

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notesheet fetched successfully",
      data: notesheet
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getAllNotesheets = async (req, res) => {
  try {
    const notesheets = await Notesheet.aggregate(
      notesheetViewPipeline() // bina matchStage ke sabhi notesheets
    );

    return res.status(200).json({
      success: true,
      message: "All notesheets fetched successfully",
      data: notesheets
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getRecentApprovalFlow = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId param is required"
      });
    }

    // Find most recent notesheet for this employee
    const recentNotesheet = await Notesheet.findOne({ emp_id: empId })
      .sort({ createdAt: -1 });

    if (!recentNotesheet) {
      return res.status(404).json({
        success: false,
        message: "No notesheet found for this employee"
      });
    }

    // Get approval flow for that notesheet
    const approvalFlow = await NotesheetFlow.find({ note_id: recentNotesheet.note_id })
      .sort({ step_order: 1 }); // assuming you have step_order field

  return res.status(200).json({
  success: true,
  message: "Approval flow fetched successfully",
  data: approvalFlow.map(flow => ({
    authority: flow.authority,
    role: flow.role,          //  add role field
    status: flow.status.toLowerCase(), // approved/rejected/pending
    time: flow.updatedAt,     //  rename timestamp → time
    comment: flow.comment     //  add comment field
  }))
});

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};
