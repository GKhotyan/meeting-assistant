import type { Page } from 'playwright';
const nameSelector='#input-for-name, #inputname, input[placeholder="Your Name" i]';
export async function setPreJoinName(page:Page,name:string):Promise<boolean> {
  const field=page.locator(nameSelector).first();
  if(!await field.isVisible({timeout:1000}).catch(()=>false))return false;
  try {await field.fill(name,{timeout:3000});return await field.inputValue()===name;}catch{return false;}
}
export async function applyMeetingName(page:Page,name:string):Promise<'applied'|'restricted'|'unavailable'> {
  try {
    const participants=page.getByRole('button',{name:/^participants/i}).first();
    if(await participants.isVisible({timeout:1000}))await participants.click({timeout:2000});
    const self=page.locator('.participants-item').filter({hasText:/\(you\)|\(me\)/i}).first();
    if(!await self.isVisible({timeout:2000}))return 'unavailable';
    const current=await self.innerText();
    if(current.includes(name))return 'applied';
    await self.hover({timeout:2000});
    await self.getByRole('button',{name:/more/i}).click({timeout:2000});
    const rename=page.getByRole('menuitem',{name:/^rename$/i}).or(page.getByRole('button',{name:/^rename$/i})).first();
    if(!await rename.isVisible({timeout:1000}))return 'restricted';
    await rename.click({timeout:2000});
    const dialog=page.getByRole('dialog').filter({hasText:/rename/i}).first();
    await dialog.locator('input[type="text"]').first().fill(name,{timeout:2000});
    await dialog.getByRole('button',{name:/^(save|change|ok)$/i}).click({timeout:2000});
    return (await self.innerText()).includes(name)?'applied':'restricted';
  } catch {return 'unavailable';}
}
