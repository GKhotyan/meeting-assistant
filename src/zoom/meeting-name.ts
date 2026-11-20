import type { Page, Locator } from 'playwright';
export { setPreJoinName } from '../../vendor/vexa/join/zoom/name';
async function ownDisplayName(self:Locator):Promise<string> {
  try { return (await self.locator('.participants-item__display-name').first().innerText({timeout:1000})).trim(); }
  catch { return ''; }
}
export async function applyMeetingName(page:Page,name:string):Promise<'applied'|'restricted'|'unavailable'> {
  const participants=page.getByRole('button',{name:/(?:open|close) the participants list pane|^participants(?:\s*\(\d+\))?$/i}).first();
  let opened=false;
  try {
    const self=page.locator('.participants-item, .participants-li').filter({hasText:/\(you\)|\(me\)/i}).first();
    if(!await self.isVisible().catch(()=>false)) { await participants.click({timeout:8000}); opened=true; }
    await self.waitFor({state:'visible',timeout:5000});
    if(await ownDisplayName(self)===name)return 'applied';
    await self.hover({timeout:2000});
    await self.getByRole('button',{name:/more/i}).click({timeout:2000});
    const rename=page.getByRole('menuitem',{name:/^rename$/i}).or(page.getByRole('button',{name:/^rename$/i})).first();
    try {await rename.waitFor({state:'visible',timeout:1500});} catch {return 'restricted';}
    await rename.click({timeout:2000});
    const dialog=page.locator('.dialog-rename-container').first();
    await dialog.locator('input[type="text"]').first().fill(name,{timeout:2000});
    await dialog.getByRole('button',{name:/^(save|change|ok)$/i}).click({timeout:2000});
    await self.locator('.participants-item__display-name').first().filter({hasText:name}).waitFor({state:'visible',timeout:2000}).catch(()=>{});
    return await ownDisplayName(self)===name?'applied':'restricted';
  } catch {return 'unavailable';}
  finally {
    const renameDialog=page.locator('.dialog-rename-container').first();
    if(await renameDialog.isVisible().catch(()=>false))
      await renameDialog.getByRole('button',{name:/^cancel$/i}).click({timeout:1500}).catch(()=>{});
    if(opened) {
      const close=page.locator('.participants-section-container').getByRole('button',{name:/close/i}).first();
      if(await close.isVisible().catch(()=>false))await close.click({timeout:1500}).catch(()=>{});
      else await participants.click({timeout:1500}).catch(()=>{});
    }
  }
}
