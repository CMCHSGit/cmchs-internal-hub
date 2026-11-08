/* Words that mean the same thing to the people searching, so a search for "screen" also looks for "display" and "lcd", and
   "vaporizer" for "vaporiser". Each group is [name, kind, same, narrower]:
     same      other words for one thing: a query word or phrase that is any of them finds records holding any of them, and any
               of the group's narrower terms (a term may be several words)
     narrower  kinds of it: searching the general word finds them, but searching one does not find the rest ("masimo" must not
               find every SpO2 board, "epm 12" every ePM, "d60" the D30)
   Made from the team's synonyms list; part terms first, then equipment names. To add a group, add a line (searchRecords in model.js). */
export const SYNONYM_GROUPS = [
  ["casing / housing / rear panel", "part term", ["casing","case","outer case","housing","rear panel","rear panel assembly","rear cover","back cover","back assembly","rear housing","rear case","cover assembly","upper cover","shell","enclosure"], []],
  ["front cover / faceplate", "part term", ["front cover","front panel","front housing","front case","faceplate","module panel","front module","bezel","parameter plate"], []],
  ["screen / display", "part term", ["screen","display","lcd","touchscreen","touch screen","touch panel","primary display","main screen","monitor screen"], []],
  ["main board", "part term", ["main board","mainboard","motherboard","main control board","main control pcba","main pcb","main pcba","mainboard fru"], []],
  ["battery", "part term", ["battery","batteries","li-ion","lithium","lithium ion","smart battery","battery pack"], []],
  ["battery door", "part term", ["battery door","battery cover","battery lid","battery compartment"], []],
  ["CO2 / capnography", "part term", ["co2","etco2","capnography","capnograph"], ["aion","rhodium","microstream","sidestream","mainstream"]],
  ["water trap", "part term", ["water trap","watertrap"], ["dryline","dryline ii","receptacle"]],
  ["SpO2", "part term", ["spo2","pulse oximetry","oximetry","pleth"], ["masimo"]],
  ["NIBP / blood pressure", "part term", ["nibp","blood pressure"], ["nibp pump","nibp valve","cuff"]],
  ["maintenance kit", "part term", ["pm kit","maintenance kit","service kit"], ["pmv kit","1 year kit","one year kit","3 year kit","comprehensive kit"]],
  ["vaporiser", "part term", ["vaporiser","vaporizer","vapouriser"], ["sevo","sevoflurane","dosing port","inlet port"]],
  ["cable / lead", "part term", ["cable","lead","wire"], ["trunk cable"]],
  ["thermometer", "part term", ["thermometer","temp probe","temperature probe"], ["exergen","trutemp","trutymp","smartemp"]],
  ["dock / cradle", "part term", ["dock","docking station","cradle"], []],
  ["recorder door", "part term", ["recorder door","printer door","paper door"], []],
  ["regulator / yoke", "part term", ["regulator","cylinder regulator","gas regulator"], ["yoke"]],
  ["power supply", "part term", ["power supply","psu","power board"], ["power management board","dc-dc board"]],
  ["warranty / RMA", "part term", ["warranty","replacement under warranty"], ["rma","return merchandise authorization"]],
  ["FRU", "part term", ["fru","field replaceable unit"], ["spare part"]],
  ["N1", "equipment alias", ["n1","benevision n1","mindray n1","n1 patient monitor"], []],
  ["VS9", "equipment alias", ["vs9","vs 9","vs-9","vs9 vital signs monitor"], []],
  ["VS900", "equipment alias", ["vs900","vs 900","vs-900"], []],
  ["VS600", "equipment alias", ["vs600","vs 600","vs-600"], []],
  ["ePM", "equipment alias", ["epm"], ["epm 10","epm 12","epm 12m","epm 15","epm15"]],
  ["uMEC / iMEC", "equipment alias", ["umec","imec"], ["umec12","imec10"]],
  ["A9", "equipment alias", ["a9","mindray a9","a9 anaesthesia machine","a9 anesthesia"], []],
  ["A7", "equipment alias", ["a7","mindray a7"], []],
  ["WATO", "equipment alias", ["wato","wato 35","wato ex-35","wato 35 anaesthesia"], []],
  ["SV800", "equipment alias", ["sv800","sv 800","tv80"], ["ventilator"]],
  ["TM80", "equipment alias", ["tm80","tm 80"], ["telemetry"]],
  ["T1", "equipment alias", ["t1","t1 transport monitor"], []],
  ["D60 / BeneHeart", "equipment alias", ["beneheart","defibrillator","defib","aed"], ["d60","d30"]],
  ["CMS", "equipment alias", ["cms","central monitoring system","benevision cms"], []],
]
