import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname.replace(/^\//, '');
const input = `${root}steam-achievements-named.csv`;
const outEn = `${root}steam-achievements-en.csv`;
const outTw = `${root}steam-achievements-zh-TW.csv`;

const titleEn = {
  A01:'Mining: First Steps', A02:'Planetary Development: First Steps', A03:'Refining: First Steps', A04:'Gas Harvesting: First Steps', A05:'Ship Engineering: First Steps', A06:'Equipment Manufacturing: First Steps', A08:'Booster Engineering: First Steps',
  A10:'Laser Turret Operation: First Steps', A11:'Projectile Turret Operation: First Steps', A12:'Missile Operation: First Steps', A13:'Defense: First Steps', A14:'Shield Operation: First Steps', A15:'Armor Reinforcement: First Steps', A16:'Ship Structure Engineering: First Steps', A17:'Targeting: First Steps', A18:'Piloting: First Steps', A19:'Capacitor Management: First Steps', A20:'Archaeology: First Steps',
  A21:'Mining Tycoon', A22:'Frontier Developer', A23:'So Refining Skills Are Worth Something, Right?', A24:'Gas Is Not Just for Fuel...', A25:'The Alliance Said There Would Be No Reimbursement', A26:'The Alliance Only Reimburses Empty Hulls', A28:'I Cannot Afford Boosters', A30:'Why Do Lasers Need Ammunition?', A31:'Vor!', A32:'Missile Racks Are More Than Decoration', A33:'Save Money on Cake and Doughnuts', A34:'Shield Tank Enthusiast', A35:'Armor Tank Enthusiast', A36:'A Real Man', A37:'I See It!', A38:'Nothing to Fear If You Cannot Hit Anything', A39:'137.7 AU', A40:'Technology Does Not Need Archaeology', A46:'How Much Did You Spend on Brain Fluid?',
  B01:'Ferrite-Silicate Ore: The Beginning of Everything', B08:'Standard Titanium Is the Foundation of the Universe', B15:'Breaking the 1,000,000 Mark', B16:'Breaking the 100,000,000 Mark', B17:'Take a Deep Breath in the Nebula', B18:'Nebula Sustainer',
  C01:'The First Rivet', C02:'Launch Ceremony', C03:'Under the Firmament, Every Route Is Open', C04:'Heavy Bastion: Mobile Fortress', C05:'Worldbreaker, Breaking Through the Lines', C06:'Mountains and Seas Can Be Leveled', C07:'Dawnstar: The First Light of Dawn', C08:'Crowned by the Stars', C09:'Everhold: The City That Never Falls', C10:'Judgment: Final Verdict', C11:'Blueprint: Civilization\'s Copier', C13:'The Oath of Twenty-Five Titans',
  D11:'The First Adrenaline Shot', D12:'A Thousand, One After Another', D13:'The First Work on the Assembly Line', D14:'Light the Fuse', D15:'The First Salvo', D16:'Hone the Edge', D17:'The First Piece of the Puzzle',
  E01:'Dust Settles at the Outpost', E02:'Expose the False Oath', E03:'Break the Silence', E04:'The Raiders\' Last Stand', E05:'The Sacrifice Ends', E06:'Seize Control', E07:'The Hunter Becomes the Hunted', E08:'Crimson: The Temple Falls', E09:'Reject Assimilation', E10:'Break the Line', E11:'The Iron Temple\'s Furnace Goes Cold', E12:'Command Matrix Collapse', E13:'Clear the Outer Ring', E14:'The Sacred Vault, Stripped Bare', E15:'Array Silenced', E16:'A New Ruler for the Royal Court', E17:'The End of the Deep', E18:'The Mastermind Goes Offline', E19:'Conqueror of the Star Belts', E24:'A Flagship Falls', E25:'Dusk of the Behemoth', E26:'Do We Really Have to Enter Through the Acceleration Gate?', E27:'Return with a Full Hold',
  F01:'The Probe\'s First Beep', F17:'Into the Deep Past', F18:'New, Brand-New, Undeniably New', F21:'Open the Door?',
  G01:'Nice Ball', G02:'That Ball Is So White', G03:'Also a Nice Ball', G04:'A Truly Nice Ball', G05:'I Came to Grow Crops. What Are You Doing?', G06:'Known as the Little Balloon', G07:'Mind the Poop Scoop',
  H01:'The First Deep-Space Anchor', H02:'Deep-Space Hub', H03:'Master Resource Dispatcher', H04:'Planetary Governor', H05:'Empire of Furnaces', H06:'King of the Assembly Line', H07:'Booster Master', H08:'Time Salvager', H09:'War Machine', H10:'Cradle of Titans',
  I01:'The First Million', I02:'The Hundred-Million Club', I03:'Starcoin Magnate', J01:'The First Day of Idling', J02:'Seven Days of Idling', J05:'Full-Load Operation', J06:'The Shipyard Has Seen Worse', J07:'Halfway to Glory', J08:'A Hundred Achievements', J09:'Completionist Collector'
};

const termEn = [
  ['技能','Skill'],['采矿','Mining'],['行星开发','Planetary Development'],['冶炼','Refining'],['气体采集','Gas Harvesting'],['舰船工程','Ship Engineering'],['装备制造','Equipment Manufacturing'],['增强剂工程','Booster Engineering'],['激光炮操作','Laser Turret Operation'],['火炮操作','Projectile Turret Operation'],['导弹操作','Missile Operation'],['防御','Defense'],['护盾操作','Shield Operation'],['装甲强化','Armor Reinforcement'],['舰船结构工程','Ship Structure Engineering'],['锁定','Targeting'],['驾驶','Piloting'],['电容管理','Capacitor Management'],['考古','Archaeology'],['采矿工业','Mining Industry'],['舰船工程','Ship Engineering'],['装备/增强剂','Equipment/Boosters'],['战斗','Combat'],['行星','Planetary'],['空间站','Space Station'],['经济','Economy'],['综合','General'],['首次','First'],['累计','Total'],['达到','Reach'],['级',''],['总装','Assemble'],['首艘','first'],['首次通关','First clear of'],['击杀首艘','Destroy the first'],['首次进入','Enter for the first time'],['完整通关一次','Complete a full run of'],['首次扫描遗迹','Scan a ruin for the first time'],['完成全部','Complete all'],['首次出售文物','Sell an artifact for the first time'],['触发首次稀有掉落','Trigger the first rare drop'],['首次殖民','Colonize for the first time'],['同时运营','Operate'],['建成','Build'],['本体升至','Raise the core to'],['升至','Raise to'],['获得首张蓝图','Obtain the first blueprint'],['制造首个任意增强剂','Manufacture the first booster'],['首次装备制造','Manufacture equipment for the first time'],['首次燃料制造','Manufacture fuel for the first time'],['首次弹药制造','Manufacture ammunition for the first time'],['首次装备强化','Enhance equipment for the first time'],['制造首件改装件','Manufacture the first modification'],['历史峰值持有','Reach a historical holding peak of'],['星币','Starcoin'],['累计在线','Accumulate'],['小时','hours online'],['天','days online'],['达成','Earn'],['完成全部成就','Complete all achievements'],['动作队列排满','Fill the action queue with'],['项','items'],['重创后维修并恢复出击','Repair and return to action after a critical hit']
];

const skillEn = {'采矿':'Mining','行星开发':'Planetary Development','冶炼':'Refining','气体采集':'Gas Harvesting','舰船工程':'Ship Engineering','装备制造':'Equipment Manufacturing','增强剂工程':'Booster Engineering','激光炮操作':'Laser Turret Operation','火炮操作':'Projectile Turret Operation','导弹操作':'Missile Operation','防御':'Defense','护盾操作':'Shield Operation','装甲强化':'Armor Reinforcement','舰船结构工程':'Ship Structure Engineering','锁定':'Targeting','驾驶':'Piloting','电容管理':'Capacitor Management','考古':'Archaeology'};
const classEn = {'苍穹劫团':'Sky Heist','赤誓教团':'Crimson Oath','静默集群':'Silent Cluster'};
const shipEn = {'天穹级':'Firmament-class','重垒级':'Bastion-class','裂界级':'Worldbreaker-class','山海级':'Mountain-Sea-class','启明级':'Dawnstar-class','星冕级':'Starcrown-class','恒城级':'Everhold-class','裁决级':'Judgment-class'};
function translateCondition(s) {
  let m;
  if ((m=s.match(/^技能 <(.+)> 达到 (\d+) 级$/))) return `Reach Level ${m[2]} in ${skillEn[m[1]]||m[1]}`;
  if ((m=s.match(/^全部技能达 Lv\.(\d+)$/))) return `Reach Level ${m[1]} in every skill`;
  if ((m=s.match(/^累计采矿 ([\d,]+)$/))) return `Mine ${m[1]} ore in total`;
  if ((m=s.match(/^累计气体 ([\d,]+)$/))) return `Harvest ${m[1]} gas in total`;
  if (s==='首次采集 铁硅原矿') return 'Mine Ferrite-Silicate Ore for the first time';
  if (s==='首次冶炼 标准钛材') return 'Refine Standard Titanium for the first time';
  if (s==='首次气体采集') return 'Harvest gas for the first time';
  if ((m=s.match(/^制造首个舰船部件$/))) return 'Manufacture your first ship component';
  if ((m=s.match(/^总装首艘(?: ?(.+))?$/))) return `Assemble your first ${m[1] ? (shipEn[m[1]]||({'舰船':'ship'}[m[1]]||m[1])) : 'ship'}`;
  if ((m=s.match(/^累计建造 (\d+) 艘超级旗舰$/))) return `Build ${m[1]} supercapital ships in total`;
  if (s==='获得首张蓝图') return 'Obtain your first blueprint';
  if (s==='制造首个任意增强剂') return 'Manufacture your first booster';
  if (s==='累计制造 1,000 个增强剂') return 'Manufacture 1,000 boosters in total';
  if (s==='首次装备制造') return 'Manufacture equipment for the first time';
  if (s==='首次燃料制造') return 'Manufacture fuel for the first time';
  if (s==='首次弹药制造') return 'Manufacture ammunition for the first time';
  if (s==='首次装备强化') return 'Enhance equipment for the first time';
  if (s==='制造首件改装件') return 'Manufacture your first modification';
  if ((m=s.match(/^首次通关战斗星带：(.+)$/))) return `First clear of Combat Star Belt: ${m[1].replaceAll('苍穹劫团','Sky Heist').replaceAll('赤誓教团','Crimson Oath').replaceAll('静默集群','Silent Cluster').replaceAll('前哨站','Outpost').replaceAll('隐蔽所','Hideout').replaceAll('哨站','Station').replaceAll('劫掠走廊','Raid Corridor').replaceAll('献祭场','Sacrificial Grounds').replaceAll('控制节点','Control Node').replaceAll('猎杀空域','Hunting Grounds').replaceAll('深红圣堂','Crimson Temple').replaceAll('同化枢纽','Assimilation Hub').replaceAll('破阵战场','Breach Battlefield').replaceAll('铁血圣殿','Iron Temple').replaceAll('统御矩阵','Command Matrix').replaceAll('外环侵袭区','Outer-Ring Invasion Zone').replaceAll('外环圣库','Outer-Ring Sacred Vault').replaceAll('外环同化阵列','Outer-Ring Assimilation Array').replaceAll('深域王庭','Deep-Realm Court').replaceAll('深域圣殿','Deep-Realm Temple').replaceAll('深域主脑','Deep-Realm Mastermind').replaceAll('Sky Heist','Sky Heist: ').replaceAll('Crimson Oath','Crimson Oath: ').replaceAll('Silent Cluster','Silent Cluster: ').replaceAll(':  ',' : ')}`;
  if (s==='通关全部 18 个战斗星带') return 'Clear all 18 Combat Star Belts';
  if (s==='击杀首艘旗舰级敌人') return 'Destroy your first capital-class enemy';
  if (s==='击杀首艘超级旗舰级敌人') return 'Destroy your first supercapital-class enemy';
  if (s==='首次进入死亡空间') return 'Enter Deadspace for the first time';
  if (s==='完整通关一次死亡空间') return 'Complete a full Deadspace run';
  if (s==='首次扫描遗迹') return 'Scan a ruin for the first time';
  if (s==='完成全部 5 档考古') return 'Complete all 5 archaeology tiers';
  if (s==='首次出售文物') return 'Sell an artifact for the first time';
  if (s==='触发首次稀有掉落') return 'Trigger your first rare drop';
  if ((m=s.match(/^首次殖民 (.+)$/))) { const planet=({'熔岩行星':'Lava Planet','气态行星':'Gas Planet','冰行星':'Ice Planet','等离子行星':'Plasma Planet','温带行星':'Temperate Planet','风暴行星':'Storm Planet'}[m[1]]||m[1]); return `Colonize an ${planet}`.replace('an Lava','a Lava').replace('an Gas','a Gas').replace('an Temperate','a Temperate').replace('an Storm','a Storm')+' for the first time'; }
  if ((m=s.match(/^同时运营 (\d+) 颗行星$/))) return `Operate ${m[1]} planets simultaneously`;
  if (s==='建成空间站本体 Lv.1') return 'Build the space-station core to Level 1';
  if ((m=s.match(/^本体升至 Lv\.(\d+)$/))) return `Raise the space-station core to Level ${m[1]}`;
  const station={'资源调度中心':'Resource Dispatch Center','行星管控中心':'Planetary Control Center','冶炼精炼厂':'Smelting Refinery','装备制造厂':'Equipment Factory','增强剂制造厂':'Booster Factory','考古实验室':'Archaeology Lab','作战指挥中心':'Combat Command Center','舰船船坞':'Shipyard'};
  if ((m=s.match(/^(.+) 升至 Lv\.(\d+)$/)) && station[m[1]]) return `Raise the ${station[m[1]]} to Level ${m[2]}`;
  if ((m=s.match(/^历史峰值持有 ([\d,]+) 星币$/))) return `Reach a historical holding peak of ${m[1]} Starcoin`;
  if ((m=s.match(/^累计在线 (\d+) 小时$/))) return `Accumulate ${m[1]} hours online`;
  if ((m=s.match(/^累计在线 (\d+) 天$/))) return `Accumulate ${m[1]} days online`;
  if ((m=s.match(/^动作队列排满 (\d+) 项$/))) return `Fill the action queue with ${m[1]} items`;
  if (s==='首次重创后维修并恢复出击') return 'Repair and return to action after a critical hit';
  if ((m=s.match(/^达成 (\d+) 项成就$/))) return `Earn ${m[1]} achievements`;
  if (s==='完成全部成就') return 'Complete all achievements';
  return s;
}

const tradMap = {'采':'採','矿':'礦','冶':'冶','炼':'煉','气':'氣','体':'體','舰':'艦','船':'船','术':'術','装':'裝','备':'備','增':'增','强':'強','剂':'劑','炮':'砲','护':'護','盾':'盾','锁':'鎖','驾':'駕','驶':'駛','电':'電','容':'容','管':'管','考':'考','古':'古','业':'業','战':'戰','斗':'鬥','行':'行','星':'星','间':'間','站':'站','经':'經','济':'濟','综':'綜','合':'合','铜':'銅','银':'銀','金':'金','传':'傳','奇':'奇','达':'達','级':'級','首':'首','个':'個','总':'總','获':'獲','张':'張','蓝':'藍','图':'圖','制':'製','造':'造','燃':'燃','料':'料','弹':'彈','药':'藥','强':'強','化':'化','改':'改','件':'件','累':'累','计':'計','历':'歷','史':'史','峰':'峰','值':'值','持':'持','有':'有','币':'幣','线':'線','满':'滿','项':'項','重':'重','创':'創','后':'後','维':'維','修':'修','复':'復','出':'出','击':'擊','完':'完','成':'成','隐':'隱','藏':'藏','深':'深','空':'空','资':'資','源':'源','调':'調','度':'度','炼':'煉','厂':'廠','药':'藥','剂':'劑','实':'實','验':'驗','室':'室','作':'作','指':'指','挥':'揮','中':'中','心':'心','坞':'塢','财':'財','富':'富','队':'隊','列':'列','维':'維','修':'修','归':'歸','档':'檔','案':'案'};
function trad(s) {
  let x = [...s].map(c=>tradMap[c] || c).join('');
  for (const [a,b] of [['初窥门径','初窺門徑'],['行星开发','行星開發'],['增强剂工程','增強劑工程'],['激光','雷射'],['铁硅原矿','鐵矽原礦'],['标准钛材','標準鈦材'],['战斗星带','戰鬥星帶'],['死亡空间','死亡空間'],['空间站','空間站'],['星币','星幣'],['超级旗舰','超級旗艦'],['气态','氣態'],['温带','溫帶'],['风暴','風暴'],['本体','本體'],['隐藏','隱藏']]) x=x.replaceAll(a,b);
  return x;
}
const categoryEn = {'技能':'Skill','采矿工业':'Mining Industry','舰船工程':'Ship Engineering','装备/增强剂':'Equipment/Boosters','战斗':'Combat','考古':'Archaeology','行星':'Planetary','空间站':'Space Station','经济':'Economy','综合':'General'};
const tierEn = {'铜':'Bronze','银':'Silver','金':'Gold','传奇':'Legendary'};

function parseCsv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for (let i=0;i<text.length;i++) { const c=text[i]; if (c==='"') { if (quoted && text[i+1]==='"') { cell+='"'; i++; } else quoted=!quoted; } else if (c===','&&!quoted) { row.push(cell); cell=''; } else if ((c==='\n'||c==='\r')&&!quoted) { if(c==='\r'&&text[i+1]==='\n')i++; row.push(cell); rows.push(row); row=[]; cell=''; } else cell+=c; }
  if(cell||row.length){row.push(cell);rows.push(row);} return rows;
}
function csvCell(v) { v=String(v??''); return /[",\r\n]/.test(v) ? '"'+v.replaceAll('"','""')+'"' : v; }
const rows = parseCsv(await fs.readFile(input,'utf8'));
const head = rows[0];
const outHead = ['ID','Category','Condition','Tier','Hidden','Display Name','Notes','Steam API Name','Steam Progress Stat','Progress Max','Batch'];
const en = [outHead], tw = [outHead];
for (const r of rows.slice(1)) {
  const id=r[0], enRow=[id,categoryEn[r[1]]||r[1],translateCondition(r[2]),tierEn[r[3]]||r[3],r[4]==='否'?'No':'Yes',titleEn[id]||r[5],r[6],r[7],r[8],r[9],r[10]];
  en.push(enRow); tw.push([id,trad(r[1]),trad(r[2]),trad(r[3]),trad(r[4]),trad(r[5]),trad(r[6]),r[7],r[8],r[9],r[10]]);
}
const serialize = rows => rows.map(r=>r.map(csvCell).join(',')).join('\n')+'\n';
await fs.writeFile(outEn, serialize(en), 'utf8');
await fs.writeFile(outTw, serialize(tw), 'utf8');
console.log(`Wrote ${en.length-1} rows to ${outEn} and ${outTw}`);
