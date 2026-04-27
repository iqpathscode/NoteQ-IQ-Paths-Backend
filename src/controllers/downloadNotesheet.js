import Notesheet from "../models/notes/notesheet.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Department from "../models/office/department.model.js";
import School from "../models/office/school.model.js";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

// ================= FLOW =================
const getApprovalFlowData = async (noteId) => {
  return await NotesheetFlow.aggregate([
    { $match: { note_id: Number(noteId) } },

    {
      $lookup: {
        from: "employees",
        localField: "from_emp_id",
        foreignField: "emp_id",
        as: "fromEmployee",
      },
    },
    { $unwind: { path: "$fromEmployee", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "employees",
        localField: "to_emp_id",
        foreignField: "emp_id",
        as: "toEmployee",
      },
    },
    { $unwind: { path: "$toEmployee", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "roles",
        localField: "to_role_id",
        foreignField: "role_id",
        as: "toRole",
      },
    },
    {
      $lookup: {
        from: "roles",
        localField: "from_role_id",
        foreignField: "role_id",
        as: "fromRole",
      },
    },

    { $unwind: { path: "$toRole", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$fromRole", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "employees",
        let: { roleId: "$to_role_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$$roleId", "$role_ids"] } } },
          { $limit: 1 },
        ],
        as: "roleEmployee",
      },
    },
    { $unwind: { path: "$roleEmployee", preserveNullAndEmptyArrays: true } },

    {
      $addFields: {
        from_name: {
          $ifNull: [
            "$from_emp_name",
            "$fromEmployee.emp_name",
            "$fromRole.role_name",
          ],
        },
        to_name: {
          $ifNull: [
            "$to_emp_name",
            "$toEmployee.emp_name",
            "$roleEmployee.emp_name",
            "$toRole.role_name",
          ],
        },
        from_role_name: {
          $ifNull: [
            "$fromRole.role_name",
            "$fromEmployee.active_role_name",
            "Employee",
          ],
        },
        to_role_name: {
          $ifNull: [
            "$toRole.role_name",
            "$roleEmployee.active_role_name",
            "Employee",
          ],
        },
      },
    },

    {
      $project: {
        action: 1,
        remark: 1,
        createdAt: 1,
        from_name: 1,
        to_name: 1,
        from_role_name: 1,
        to_role_name: 1,
      },
    },

    { $sort: { createdAt: 1 } },
  ]);
};

// ================= PDF =================
const generatePDFBuffer = async (noteId) => {
  return new Promise(async (resolve) => {
    try {
      const margin = 70;
      const doc = new PDFDocument({ margin });
      doc.lineGap(3);

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });
      if (!notesheet) return resolve(null);

      const creator = await Employee.findOne({
        emp_id: notesheet.created_by_emp_id,
      });
      const role = await Role.findOne({ role_id: creator?.active_role_id });
      const department = await Department.findOne({
        dept_id: creator?.dept_id,
      });
      const school = await School.findOne({ school_id: creator?.school_id });

      const flow = await getApprovalFlowData(noteId);
      const pageWidth = doc.page.width - margin * 2;

      // ===== HEADER =====
      const logoPath = path.join(process.cwd(), "src", "assets", "newLogo.png");
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin, 40, { width: 100 });
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .text("NOTESHEET", 0, 45, { align: "center" });

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Date: ${new Date(notesheet.createdAt).toLocaleString("en-IN")}`,
          margin,
          45,
          { align: "right" },
        );

      doc.moveDown(3);

      // ===== DETAILS =====
      doc.font("Helvetica-Bold").text("Basic Details:");
      doc.moveDown(0.5);

      doc.font("Helvetica");
      doc.text(`Created By: ${creator?.emp_name || "-"}`);
      doc.text(`Role: ${role?.role_name || "Employee"}`);
      doc.text(`Designation: ${creator?.designation || "-"}`);

      if (department?.dept_name)
        doc.text(`Department: ${department.dept_name}`);
      if (school?.school_name) doc.text(`School: ${school.school_name}`);

      doc.moveDown(0.5);

      doc.text(`Notesheet ID: ${notesheet.note_id}`);
      doc.text(`Status: ${notesheet.status}`);
      doc.text(
        `Created At: ${new Date(notesheet.createdAt).toLocaleString("en-IN")}`,
      );

      doc.moveDown();

      // ===== SUBJECT =====
      doc
        .font("Helvetica-Bold")
        .text("Subject: ", { continued: true })
        .font("Helvetica")
        .text(notesheet.subject);

      doc.moveDown();

      // ===== DESCRIPTION =====
      doc.font("Helvetica-Bold").text("Description:");

      doc.font("Helvetica").text(notesheet.description || "-", {
        width: pageWidth,
        align: "justify",
        lineGap: 4,
        paragraphGap: 6,
      });
      doc.moveDown();
      doc.text("The note is submitted for kind approval and necessary action.");
      doc.moveDown(2);

      // ===== FLOW =====
      doc.font("Helvetica-Bold").text("Approval Flow");
      doc.moveDown();

      doc
        .moveTo(margin, doc.y)
        .lineTo(margin + pageWidth, doc.y)
        .stroke();

      doc.moveDown();

      if (flow.length === 0) {
        doc.text("No approval flow available");
      } else {
        flow.forEach((f, i) => {
          const fromName = f.from_name || "Unknown";
          const toName = f.to_name || "N/A";

          const fromRole = f.from_role_name || "Employee";
          const toRole = f.to_role_name || "Employee";

          const actionLower = String(f.action).toLowerCase();

          const remarkText = Array.isArray(f.remark)
            ? f.remark.join(", ")
            : f.remark;

          // ===== MAIN =====
          doc
            .font("Helvetica-Bold")
            .text(`${i + 1}. ${fromName} (${fromRole})`);

          // ONLY when not approved/rejected
          if (!["approved", "rejected"].includes(actionLower)) {
            doc.font("Helvetica").text(`Forwarded To: ${toName} (${toRole})`);
          }

          // ===== ACTION =====
          doc
            .font("Helvetica-Bold")
            .text(`Action: ${f.action}`, { continued: true })
            .font("Helvetica")
            .text(` | Date: ${new Date(f.createdAt).toLocaleString("en-IN")}`);

          // ===== REMARK =====
          if (remarkText) {
            doc.text(`Remark: ${remarkText}`);
          }

          doc.moveDown();
        });
      }
      // ===== FINAL SIGNATURE =====
      const finalAction = flow
        .slice()
        .reverse()
        .find((f) =>
          ["approved", "rejected"].includes(String(f.action).toLowerCase()),
        );

      if (finalAction) {
        doc.moveDown(2);

        const rightX = margin + pageWidth / 2;

        // NAME (approver)
        doc
          .font("Helvetica-Bold")
          .text(finalAction.from_name || "-", rightX, doc.y, {
            width: pageWidth / 2,
            align: "right",
          });

        // ROLE (approver role)
        doc.font("Helvetica").text(finalAction.from_role_name || "Employee", {
          width: pageWidth / 2,
          align: "right",
        });
      }

      // ===== ATTACHMENTS =====
      doc.moveDown(2);

      doc.font("Helvetica-Bold").text("Attachments:", {
        width: pageWidth / 2,
        align: "right",
      });

      doc.moveDown(0.5);

      if (notesheet.attachments?.length) {
        notesheet.attachments.forEach((file, i) => {
          doc.fillColor("blue").text(`Attachment ${i + 1}`, {
            link: file,
            underline: true,
            width: pageWidth / 2,
            align: "right",
          });

          doc.moveDown(0.3);
        });
        doc.fillColor("black");
      } else {
        doc.text("No attachment", {
          width: pageWidth / 2,
          align: "right",
        });
      }

      doc.end();
    } catch (err) {
      console.error(err);
      resolve(null);
    }
  });
};

// ================= DOWNLOAD =================
export const downloadNotesheet = async (req, res) => {
  const pdfBuffer = await generatePDFBuffer(req.params.id);

  if (!pdfBuffer) return res.status(404).send("Not found");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=notesheet_${req.params.id}.pdf`,
  );

  res.send(pdfBuffer);
};

// ================= BULK =================
export const bulkDownload = async (req, res) => {
  const { ids } = req.body;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=notesheets.zip");

  const archive = archiver("zip");
  archive.pipe(res);

  for (const id of ids) {
    const pdfBuffer = await generatePDFBuffer(id);
    if (pdfBuffer) {
      archive.append(pdfBuffer, { name: `notesheet_${id}.pdf` });
    }
  }

  archive.finalize();
};
