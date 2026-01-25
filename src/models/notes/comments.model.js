// import mongoose from 'mongoose';

// const notesheetCommentSchema = new mongoose.Schema({
//   note_id: {
//     type : Number,
//     // type: mongoose.Schema.Types.ObjectId,
//     // ref: 'Notesheet',
//     required: true
//   },
//   comment_description: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   created_by: {
//     type : Number,
//     // type: mongoose.Schema.Types.ObjectId,
//     // ref: 'Role',
//     required: true
//   },
//   updated_time: {
//     type: Date,
//     default: Date.now,
//     required: true
//   }
// }, {
//   timestamps: true
// });

// const NotesheetComment = mongoose.model('NotesheetComment', notesheetCommentSchema);

// export default NotesheetComment;


import mongoose from 'mongoose';

const notesheetCommentSchema = new mongoose.Schema(
  {
    note_id: {
      type: Number,
      required: true
    },

    emp_id: {
      type: Number,
      required: true
    },

    comment: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

notesheetCommentSchema.index({ note_id: 1, createdAt: 1 });

const NotesheetComment = mongoose.model(
  'NotesheetComment',
  notesheetCommentSchema
);

export default NotesheetComment;
