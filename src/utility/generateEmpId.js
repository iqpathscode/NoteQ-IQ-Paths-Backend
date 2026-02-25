import { Counter } from "../models/counter/counter.model.js";

export async function generateEmpId() {
  const counter = await Counter.findOneAndUpdate(
    { name: "employee" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}
