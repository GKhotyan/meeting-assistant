import type { Page } from 'playwright';
const nameSelector='#input-for-name, #inputname, input[placeholder="Your Name" i]';
export async function setPreJoinName(page:Page,name:string):Promise<boolean> {
  const field=page.locator(nameSelector).first();
  try { await field.waitFor({state:'visible',timeout:5000}); } catch { return false; }
  try {await field.fill(name,{timeout:3000});return await field.inputValue()===name;}catch{return false;}
}
