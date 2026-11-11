import { prepareTestDatabase } from "../database";
export default async function setup() {
  await prepareTestDatabase();
}
