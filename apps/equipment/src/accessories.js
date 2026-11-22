/* The accessory catalogue the loan's Accessories picker suggests from (model.js accessoryCatalogue), beside
   every code already used on a loan. One line an accessory:

     { code: '0010-30-42726', name: 'SpO2 sensor, adult, reusable', models: ['ePM 12M', 'N17'], group: 'SpO2' }

   `models` (optional) are the monitors it suits: picking one of them for a loan puts it first. `group`
   (optional) is how it's sorted in the list. Codes and names only: never prices or anything private, since
   this repo is public. Empty until the team's list arrives (23 Nov 2026); until then the picker suggests
   the codes people have typed on earlier loans. */
export const ACCESSORY_LIST = []
