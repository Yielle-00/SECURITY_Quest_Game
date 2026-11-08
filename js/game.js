(function(){

// ======================================================
// LEVEL DEFINITIONS
// ======================================================
// ======================================================
// LEVEL KIT: small helpers every world's environment code shares
//   - seeded random, so a world looks the same every visit
//   - solids (things the sentinel cannot walk through, see resolveSolids)
//   - instanced meshes, so repeated things (windows, tiles...) are one draw call
//   - generic buildings / rows of buildings with lit windows
//   - signs: a flat panel with text painted on it
// ======================================================
function levelKit(scene, env, seed){
  env.solids = env.solids || [];

  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(seed || 1);

  const mat  = (c, o)=> new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:0.85}, o||{}));
  const box  = (w,h,d,c,o)=> new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(c,o));
  const cyl  = (rt,rb,h,c,o,seg)=> new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||12), mat(c,o));
  const sph  = (r,c,o,seg)=> new THREE.Mesh(new THREE.SphereGeometry(r,seg||12,seg||10), mat(c,o));
  const cone = (r,h,c,o,seg)=> new THREE.Mesh(new THREE.ConeGeometry(r,h,seg||10), mat(c,o));
  const put  = (obj,x,y,z)=>{ obj.position.set(x,y,z); return obj; };

  // solids the sentinel cannot walk through. h is the object's height: low things can be jumped over.
  const solidBox    = (x,z,hx,hz,h,rot)=> env.solids.push({x,z,hx,hz,h,rot:rot||0});
  const solidCircle = (x,z,r,h)=> env.solids.push({x,z,r,h});
  const addSolid    = (group,hx,hz,h)=> env.solids.push({group,hx,hz,h});   // follows a live (moving) group

  // many copies of one shape in a single draw call
  const dummy = new THREE.Object3D();
  function instanced(geo, material, list){
    const m = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((p,i)=>{
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry||0, 0); dummy.scale.set(1,1,1);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true; m.frustumCulled = false;
    return m;
  }

  // a flat panel with text painted on it (always bright, so it reads as a sign or a screen)
  function label(text, w, h, opt){
    opt = opt || {};
    const c = document.createElement('canvas');
    c.width = 512; c.height = Math.max(64, Math.round(512*h/w));
    const g = c.getContext('2d');
    if(opt.bg){ g.fillStyle = opt.bg; g.fillRect(0,0,c.width,c.height); }
    g.fillStyle = opt.fg || '#FFFFFF';
    g.font = '700 ' + Math.round(c.height*(opt.size || 0.42)) + 'px Fredoka, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((ln,i)=> g.fillText(ln, c.width/2, c.height*(i+1)/(lines.length+1)));
    const tex = new THREE.CanvasTexture(c);
    return new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({map:tex, transparent:true, side:THREE.DoubleSide}));
  }

  // ---- windows (instanced, so dozens of buildings stay cheap) ---------------------------------
  const winGeo = new THREE.PlaneGeometry(0.9,1.3);
  const winLit = mat(0xFFE3A0,{emissive:0xFFDD8F, emissiveIntensity:0.7, roughness:0.5});
  const winDark = mat(0x18232E,{roughness:0.4, metalness:0.2});
  function addWindows(body, w, h, d, startY, litChance){
    startY = startY === undefined ? 3.4 : startY;
    litChance = litChance === undefined ? 0.55 : litChance;
    const cols = Math.max(3, Math.min(8, Math.floor(w/2.4)));
    const rows = Math.max(3, Math.min(14, Math.floor((h-startY)/3.4)));
    const lit = [], dark = [];
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        if(rnd() < 0.1) continue;
        const wx = -w/2 + 1.3 + c*((w-2.6)/Math.max(1,cols-1));
        const wy = -h/2 + startY + r*((h-startY-2.2)/Math.max(1,rows-1));   // relative to the body's centre, so they stay on the wall
        (rnd() < litChance ? lit : dark).push({x:wx, y:wy, z:d/2+0.03});
      }
    }
    if(lit.length) body.add(instanced(winGeo, winLit, lit));
    if(dark.length) body.add(instanced(winGeo, winDark, dark));
  }

  // ---- a generic building: faces N (-z), S (+z), E (+x) or W (-x) ---------------------------------
  const BODY_COLORS = [0x3A4660,0x44526E,0x2F3B52,0x4E5C78,0x39455A,0x56607A,0x6A5F66,0x4B6270,0x5A6B7B];
  const SHOP_COLORS = [0xE24E30,0x2FA6A1,0xFFC857,0x8B5CF6,0xFF4FA3,0x5FD4D0];
  function building(x, z, w, h, d, face, color, o){
    o = o || {};
    const g = new THREE.Group();
    const body = box(w,h,d,color,{roughness:0.9});
    put(body, 0,h/2,0); body.castShadow = !!o.shadow; body.receiveShadow = !!o.shadow; g.add(body);
    addWindows(body, w, h, d, o.shop ? 5.6 : 3.4, o.lit);
    g.add(put(box(w+0.5,0.5,d+0.5,o.cornice || 0x9AA3AF), 0,h+0.25,0));                // cornice
    if(o.shop){                                                                       // lit storefront, door, awning, sign
      const col = (o.shopColors || SHOP_COLORS)[Math.floor(rnd()*(o.shopColors || SHOP_COLORS).length)];
      g.add(put(box(w*0.86,3.2,0.25,0x16222C,{emissive:0xFFD9A0, emissiveIntensity:0.3, roughness:0.3}), 0,1.7,d/2+0.12));
      g.add(put(box(1.6,2.6,0.3,0x0F1820), (rnd()<0.5?-1:1)*w*0.28,1.4,d/2+0.2));
      g.add(put(box(w*0.86,0.25,1.5,col), 0,3.5,d/2+0.8));
      g.add(put(box(w*0.5,0.8,0.2,col,{emissive:col, emissiveIntensity:0.75}), 0,4.5,d/2+0.15));
    }
    if(o.roof){                                                                       // AC units, water tank, antenna
      const n = 1 + Math.floor(rnd()*3);
      for(let i=0;i<n;i++){
        g.add(put(box(1.8+rnd()*1.4,1+rnd()*0.8,1.4+rnd(),0x5C6672), (rnd()-0.5)*(w-4), h+1.0, (rnd()-0.5)*(d-4)));
      }
      if(rnd() < 0.4){
        const tx = (rnd()-0.5)*(w-5), tz = (rnd()-0.5)*(d-5);
        g.add(put(cyl(1.1,1.1,1.8,0x7A5C44,null,10), tx,h+1.4,tz));
        g.add(put(cone(1.3,0.8,0x5E4632,null,10), tx,h+2.7,tz));
      }
      if(rnd() < 0.3){
        g.add(put(cyl(0.08,0.08,6,0x8C97A3,null,6), (rnd()-0.5)*(w-4),h+3.5,(rnd()-0.5)*(d-4)));
      }
    }
    if(o.billboard){                                                                  // glowing rooftop advert
      const c = o.billboard;
      g.add(put(box(w*0.7,4.2,0.3,c,{emissive:c, emissiveIntensity:0.55}), 0,h+4.0,d/2-1.2));
      [-1,1].forEach(s=> g.add(put(box(0.3,2.4,0.3,0x2A3440), s*w*0.28,h+1.4,d/2-1.2)));
    }
    put(g, x,0,z);
    g.rotation.y = {S:0, N:Math.PI, E:Math.PI/2, W:-Math.PI/2}[face];
    scene.add(g);
    return g;
  }
  // a row of buildings along an edge; the last one is trimmed so a row never runs past its end
  function row(axis, fixed, from, to, face, hMin, hMax, dMin, dMax, o){
    o = o || {};
    const colors = o.colors || BODY_COLORS;
    let p = from, i = 0;
    while(p < to){
      let w = 8 + rnd()*6;
      if(p + w > to){ w = to - p; if(w < 6) break; }
      const h = hMin + rnd()*(hMax-hMin), d = dMin + rnd()*(dMax-dMin);
      const color = colors[Math.floor(rnd()*colors.length)];
      const along = p + w/2;
      let x, z;
      if(axis === 'x'){ x = along; z = fixed + (face === 'N' ? d/2 : -d/2); }
      else { z = along; x = fixed + (face === 'E' ? -d/2 : d/2); }
      const opts = { shop:o.shop, roof:o.roof, lit:o.lit, cornice:o.cornice, shopColors:o.shopColors };
      if(o.billboards && i % 5 === 2) opts.billboard = SHOP_COLORS[Math.floor(rnd()*SHOP_COLORS.length)];
      building(x, z, w, h, d, face, color, opts);
      p += w + 0.5 + rnd()*1.2; i++;
    }
  }

  return { scene, env, rnd, mat, box, cyl, sph, cone, put, solidBox, solidCircle, addSolid, instanced, label,
           addWindows, building, row, BODY_COLORS, SHOP_COLORS };
}

const LEVELS = [

// ---------------- LEVEL 1: CITY ----------------
{
  id:'city', title:'The City Block', icon:'🏙️',
  subtitle:'4 scenarios · street-level pretexting, tailgating & vishing',
  objective:'Find and question all 4 visitors on the street',
  fogColor:0x3A3560, fogDensity:0.014,
  // toned down: the street was blowing out to near-white under the day-shift sun
  lightScale:0.62, hemiSky:0xB9C7E0, hemiGround:0x5A6270, sunColor:0xFFEBCB,
  landmarks:[
    {name:'Office Tower', x:-14, z:-14}, {name:'Bank ATM', x:12.5, z:12.9}, {name:'Bus Stop', x:-4, z:14},
    {name:'Subway', x:-27, z:15.5}, {name:'Café', x:-33, z:25}, {name:'Newsstand', x:24, z:14},
    {name:'Fountain', x:30, z:-24}, {name:'Food Truck', x:-6, z:-36}
  ],
  playerStart:{x:0,z:22}, bounds:{x:34, zMin:-40, zMax:30},
  studs:[{x:0,z:4},{x:-8,z:20},{x:22,z:-2},{x:-26,z:22}],
  quests:[
    { id:'courier', name:'The "Urgent Delivery" Courier', pos:{x:-14,z:-6}, color:0xFF6B4A,
      technique:'Tailgating via a delivery pretext',
      tip:'A real courier can wait at the desk or call ahead — badge doors are for people who badge in themselves.',
      scenario:'You badge into the office tower. A courier juggling three boxes hustles up behind you: "Overnight package, gotta run it up — can you just grab the door, my hands are full?"',
      choices:[
        {text:"Hold the door, obviously — he's got packages and a uniform.", correct:false, feedback:"A uniform and a full hand-cart look convincing, but that's the whole trick. Tailgating relies on you making the access decision for someone else."},
        {text:'Let the door close and direct him to the front desk to sign in.', correct:true, feedback:'Right call. Every visitor — deliveries included — should be signed in and escorted through the lobby, not waved through a badge door.'},
        {text:'Take the boxes from him yourself and carry them in.', correct:false, feedback:"Better than holding the door, but you've still let an unverified person's cargo into a secure area without any check-in at all."}
      ]},
    { id:'survey', name:'The Sidewalk "Survey"', pos:{x:12,z:-16}, color:0xFFC857,
      technique:'Pretexting / information elicitation',
      tip:'Casual-sounding questions about your employer, systems, or schedule are still information gathering — keep company details off the sidewalk.',
      scenario:'A friendly stranger with a clipboard stops you outside your building: "Quick survey for a chance to win a $200 gift card! Just need your employer, your role, and what software your team uses day to day."',
      choices:[
        {text:"Answer fully — it's just a survey and there's a prize.", correct:false, feedback:'Specific questions about your employer, role, and software stack are exactly what attackers use to build a convincing pretext later. Free surveys are a common cover for this.'},
        {text:'Decline to share employer or work details, and move on.', correct:true, feedback:"Good instinct. Details like your employer, your team's tools, or your manager's name might feel harmless alone, but attackers piece these together across multiple 'small' asks."},
        {text:'Give a fake employer name to be funny but answer the rest honestly.', correct:false, feedback:"Partial deflection doesn't help — the software and role details you shared are still real, useful information for a future attack."}
      ]},
    { id:'charging', name:'The Free Charging Station', pos:{x:-20,z:14}, color:0x2FA6A1,
      technique:'Juice jacking via public USB ports',
      tip:'Use your own wall adapter or a portable battery instead of unknown public USB ports and cables — data can travel over the same cable as power.',
      scenario:'Your phone is low. A kiosk on the corner offers a free USB charging cable labeled "Charge Here, Courtesy of the City." A cable is already plugged in and waiting.',
      choices:[
        {text:'Plug straight in — free charging, no downside.', correct:false, feedback:'Public USB ports and cables can be rigged to transfer data as well as power — this is known as juice jacking, and it can compromise a phone silently.'},
        {text:'Use your own wall charger or a portable battery pack instead.', correct:true, feedback:'Exactly right. Sticking to your own cable and a power-only adapter (or a USB data-blocker) avoids the risk entirely.'},
        {text:'Plug in but only for 30 seconds, then unplug.', correct:false, feedback:"Even a short connection is enough for some attacks to begin. Time isn't the safeguard — avoiding unknown hardware is."}
      ]},
    { id:'atm', name:'The "Bank" Phone Call', pos:{x:18,z:16}, color:0xE24E30,
      technique:'Vishing (financial pretexting)',
      tip:"Banks don't ask for your full card number and PIN over an incoming call — hang up and call the number on the back of your card.",
      scenario:'Standing near an ATM, your phone rings: "This is your bank\'s fraud department — we\'ve flagged your card. Can you read me the card number and PIN so we can verify and stop the charge?"',
      choices:[
        {text:'Read out the card number and PIN — it sounds like fraud protection.', correct:false, feedback:'No legitimate bank ever needs your PIN over the phone. This is a textbook vishing script designed to sound urgent and official.'},
        {text:'Hang up and call the number on the back of your card to check.', correct:true, feedback:'Correct. Verifying through a number you already trust — not one the caller gives you — is the safest way to confirm if anything is actually wrong.'},
        {text:'Give the card number but refuse to say the PIN.', correct:false, feedback:'The card number alone is still sensitive information a real bank would never ask you to read aloud on an inbound call. Hang up and verify independently instead.'}
      ]}
  ],
  buildEnvironment(scene, env){
    const K = levelKit(scene, env, 20260928);
    const {rnd, mat, box, put, solidBox, solidCircle, addSolid, instanced, addWindows, building, row} = K;

    // ---- ground: asphalt boulevard + paved plaza + sidewalks ---------------------------
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(280,280), mat(0x474C57,{roughness:1}));
    ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);

    // the City Square on the far side of the boulevard
    const plaza = put(box(112,0.06,60,0x7B8391,{roughness:0.95}), 0,0.03,-33); plaza.receiveShadow = true; scene.add(plaza);
    const seamMat = mat(0x666E7C);
    const seamsA = [], seamsB = [];
    for(let x=-52;x<=52;x+=8) seamsA.push({x, y:0.07, z:-33});
    for(let z=-60;z<=-6;z+=8) seamsB.push({x:0, y:0.07, z});
    scene.add(instanced(new THREE.BoxGeometry(0.07,0.02,60), seamMat, seamsA));
    scene.add(instanced(new THREE.BoxGeometry(112,0.02,0.07), seamMat, seamsB));
    scene.add(put(box(112,0.2,0.5,0xB8BEC7,{roughness:0.8}), 0,0.1,-3));        // edge between boulevard and plaza

    // near sidewalk (where the player starts), deep enough that the camera never sits inside a building
    const sidewalk = put(box(220,0.12,36,0x8E949E,{roughness:0.9}), 0,0.06,29); sidewalk.receiveShadow = true; scene.add(sidewalk);
    scene.add(put(box(220,0.22,0.6,0xB8BEC7,{roughness:0.8}), 0,0.11,11));      // near curb
    const swSeams = [];
    for(let x=-108;x<=108;x+=6) swSeams.push({x, y:0.13, z:29});
    scene.add(instanced(new THREE.BoxGeometry(0.06,0.01,36), mat(0x77808B), swSeams));

    // narrow promenades down the left and right edges of the block
    [-50,50].forEach(x=>{ const p = put(box(8,0.12,108,0x8A909A,{roughness:0.9}), x,0.06,-7); p.receiveShadow = true; scene.add(p); });

    // boulevard markings: dashed centre line, solid edge lines and a zebra crossing in front of the office
    const lineMat = mat(0xE8E2C8,{emissive:0xE8E2C8, emissiveIntensity:0.1});
    const dashes = [];
    for(let x=-100;x<=100;x+=4) dashes.push({x, y:0.045, z:4});
    scene.add(instanced(new THREE.BoxGeometry(2,0.02,0.28), lineMat, dashes));
    scene.add(put(new THREE.Mesh(new THREE.BoxGeometry(220,0.02,0.2), lineMat), 0,0.045,8.0));
    scene.add(put(new THREE.Mesh(new THREE.BoxGeometry(220,0.02,0.2), lineMat), 0,0.045,-1.0));
    const zebra = [];
    for(let i=0;i<9;i++) zebra.push({x:-14, y:0.05, z:-1.0 + i*1.4});
    scene.add(instanced(new THREE.BoxGeometry(3.8,0.03,0.7), mat(0xEDEDED), zebra));

    // near street wall (faces the plaza), then a taller skyline behind it
    row('x', 48.5, -72, 72, 'N', 16, 34, 10, 14, {shop:true, roof:true, billboards:true});
    row('x', 64.0, -72, 72, 'N', 34, 66, 12, 16, {roof:true});
    // far street wall and skyline
    row('x',-61.5, -72, 72, 'S', 18, 40, 10, 14, {shop:true, roof:true, billboards:true});
    row('x',-77.0, -72, 72, 'S', 36, 72, 12, 16, {roof:true});
    // the two ends of the block (left faces east, right faces west); gaps are kept for the garage and the gas station
    row('z',-54.5, -58, -28, 'E', 14, 36, 10, 14, {shop:true, roof:true});
    row('z',-54.5,  -2,  46, 'E', 14, 36, 10, 14, {shop:true, roof:true});
    row('z', 54.5, -58, -28, 'W', 14, 36, 10, 14, {shop:true, roof:true});
    row('z', 54.5,   0,  46, 'W', 14, 36, 10, 14, {shop:true, roof:true});

    // ---- landmark: the office tower the courier waits at ----------------------------------------
    const tower = box(18,36,16,0x35516A,{roughness:0.55, metalness:0.15});
    put(tower, -14,18,-22.5); tower.castShadow = true; scene.add(tower);
    addWindows(tower, 18, 36, 16, 11);
    scene.add(put(box(14,10,1,0x1F3A46,{emissive:0x2FA6A1, emissiveIntensity:0.35, roughness:0.3}), -14,5,-14));    // glass lobby
    scene.add(put(box(3,5,0.3,0x0F2027,{emissive:0xFFC857, emissiveIntensity:0.4}), -14,2.6,-13.4));                 // door
    scene.add(put(box(5,0.25,2,0x2FA6A1), -14,5.4,-12.6));                                                           // canopy
    scene.add(put(box(18.6,0.6,16.6,0x9AA3AF), -14,36.3,-22.5));                                                     // crown
    scene.add(put(box(7,3,6,0x56677A), -14,38.1,-22.5));                                                             // penthouse
    scene.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,9,8), mat(0x8C97A3)), -14,43,-22.5));          // mast
    scene.add(put(box(14,0.7,0.2,0x5FD4D0,{emissive:0x5FD4D0, emissiveIntensity:0.8}), -14,11.3,-14.2));             // light band over the lobby
    solidBox(-14,-21.9, 9,8.6, 40, 0);

    // ---- landmark: parking garage (right end) and gas station (left end) ------------------------------
    (function parkingGarage(){
      const g = new THREE.Group();
      const slabMat = mat(0x8A919B,{roughness:0.9});
      for(let i=0;i<4;i++){
        g.add(put(new THREE.Mesh(new THREE.BoxGeometry(22,0.7,24), slabMat), 0,0.35+i*3.6,0));
        g.add(put(box(22,0.9,0.4,0x6C7480), 0,1.15+i*3.6,-11.8));
        g.add(put(box(0.4,0.9,24,0x6C7480), -10.8,1.15+i*3.6,0));
        g.add(put(box(0.4,0.9,24,0x6C7480),  10.8,1.15+i*3.6,0));
      }
      [-10,0,10].forEach(px=>[-11,0,11].forEach(pz=> g.add(put(box(0.9,14.4,0.9,0x7A828C), px,7.2,pz))));
      g.add(put(box(7,3,0.4,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.6}), 0,16.5,12.1));                   // big "P"
      g.add(put(box(1.2,2.2,0.5,0xF4F8F5,{emissive:0xF4F8F5, emissiveIntensity:0.5}), -0.9,16.5,12.4));
      put(g, 66,0,-14); g.rotation.y = -Math.PI/2;                                                                // front faces the plaza
      scene.add(g);
    })();
    (function gasStation(){
      const g = new THREE.Group();
      g.add(put(box(14,0.5,10,0xE8E2D4), 0,5.2,0));
      g.add(put(box(14.2,0.9,10.2,0xE24E30,{emissive:0xE24E30, emissiveIntensity:0.3}), 0,4.7,0));
      [[-6,-4],[6,-4],[-6,4],[6,4]].forEach(([px,pz])=> g.add(put(box(0.6,5,0.6,0x9AA3AF), px,2.5,pz)));
      [-4,4].forEach(px=>{
        g.add(put(box(1,1.8,0.8,0xF4F8F5), px,0.9,0));
        g.add(put(box(0.7,0.5,0.1,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.7}), px,1.5,0.45));
      });
      g.add(put(box(6,3.4,10,0xD9D3C3), -10.5,1.7,0));                                                           // shop
      put(g, -62,0,-17); g.rotation.y = Math.PI/2;
      scene.add(g);
    })();

    // ---- landmark: clock tower and a construction crane on the skyline -------------------------------------
    (function clockTower(){
      const g = new THREE.Group();
      g.add(put(box(7,34,7,0xB79C74,{roughness:0.9}), 0,17,0));
      g.add(put(new THREE.Mesh(new THREE.ConeGeometry(5.6,8,4), mat(0x7A3B30)), 0,38,0));
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.2,24), mat(0xF4F8F5,{emissive:0xFFF1C8, emissiveIntensity:0.45}));
      face.position.set(0,29,3.55); g.add(face);
      g.add(put(box(0.18,1.7,0.1,0x1B2A3A), 0,29.6,3.62));
      g.add(put(box(1.3,0.18,0.1,0x1B2A3A), 0.5,29,3.62));
      put(g, 30,0,-70); scene.add(g);
    })();
    (function crane(){
      const g = new THREE.Group();
      const steel = mat(0xFFC857,{roughness:0.6});
      g.add(put(box(1.6,48,1.6,0xFFC857), 0,24,0));
      g.add(put(box(34,1.1,1.1,0xFFC857), 8,48,0));
      g.add(put(box(8,1.1,1.1,0xFFC857), -17,48,0));
      g.add(put(box(2.5,2.5,2.5,0x6C7480), -19,46,0));
      g.add(put(box(2.4,2.4,2.4,0x2A3440), 0,46,0));
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,12,6), mat(0x2A3440)), 14,42,0));
      g.add(put(box(2.4,1.4,2.4,0xFF6B4A), 14,35.5,0));
      put(g, -52,0,-94); scene.add(g);
    })();

    // ---- street furniture, all of it solid ---------------------------------------------------------------------
    function streetTree(x,z){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.3,2.2,8), mat(0x5C4630)), 0,1.1,0));
      const foliage = put(new THREE.Mesh(new THREE.SphereGeometry(1.6,10,10), mat(0x2E6B4A,{roughness:0.8})), 0,2.9,0);
      foliage.castShadow = true; g.add(foliage);
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,0.3,10), mat(0x3A4048)), 0,0.15,0));
      put(g, x,0,z); solidCircle(x,z,0.65,3);
      scene.add(g);
    }
    [[-34,17],[-2,17],[14,17],[28,17],[-20,26],[36,24],[-10,33],[10,33],[30,33],[-30,33]].forEach(([x,z])=> streetTree(x,z));
    // plaza trees
    [[-36,-30],[-24,-40],[24,-40],[40,-14],[-40,-8],[8,-8],[-8,-44],[40,-44],[-44,-44]].forEach(([x,z])=> streetTree(x,z));

    function bench(x,z,rot){
      const g = new THREE.Group();
      g.add(put(box(1.6,0.1,0.5,0x3A4048), 0,0.5,0));
      g.add(put(box(1.6,0.5,0.08,0x3A4048), 0,0.75,-0.21));
      [-0.65,0.65].forEach(lx=> g.add(put(box(0.08,0.5,0.5,0x22282E), lx,0.25,0)));
      put(g, x,0,z); g.rotation.y = rot||0; scene.add(g);
      solidBox(x,z,0.85,0.32,1.0,rot||0);
    }
    bench(6,18,0); bench(-28,18,0); bench(26,-6,0); bench(-26,-12,Math.PI/2); bench(0,-38,0); bench(-14,-40,0);

    function trashBin(x,z){
      scene.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.28,0.7,10), mat(0x2B3138)), x,0.35,z));
      solidCircle(x,z,0.38,0.8);
    }
    trashBin(2,15); trashBin(-9,18); trashBin(34,16); trashBin(-6,-30);

    (function hydrant(){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,0.65,10), mat(0xE24E30)), 0,0.35,0));
      g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.15,10,10), mat(0xE24E30)), 0,0.7,0));
      put(g, 20,0,15); scene.add(g); solidCircle(20,15,0.3,0.9);
    })();

    (function mailbox(){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.85,10,1,false,0,Math.PI), mat(0x2F5FA3)), 0,0.75,0));
      g.add(put(box(0.6,0.3,0.5,0x2F5FA3), 0,0.35,0));
      put(g, -24.5,0,19); scene.add(g); solidCircle(-24.5,19,0.4,1.2);
    })();

    function streetLamp(x,z,glow){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.13,5.6,8), mat(0x2A3440)), 0,2.8,0));
      g.add(put(box(1.1,0.1,0.1,0x2A3440), 0.5,5.4,0));
      g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.28,10,10), mat(0xFFE9B8,{emissive:0xFFDD8F, emissiveIntensity:0.9})), 1.0,5.3,0));
      if(glow){ const l = new THREE.PointLight(0xFFDD8F, 0.5, 9); l.position.set(1.0,5.3,0); g.add(l); }
      put(g, x,0,z); scene.add(g); solidCircle(x,z,0.3,5.6);
    }
    [[-30,13],[-38,13],[6,13],[22,13]].forEach(([x,z])=> streetLamp(x,z,true));            // these four carry real lights (night shifts)
    [[-14,13],[34,13],[-46,13],[46,13],[-20,-5],[20,-5],[-40,-5],[40,-5]].forEach(([x,z])=> streetLamp(x,z,false));

    function trafficLight(x,z,rot){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,5.2,8), mat(0x1D2733)), 0,2.6,0));
      g.add(put(box(0.6,1.5,0.5,0x151D26), 0,5.1,0));
      [0xFF4A3D,0xFFC857,0x2FA6A1].forEach((c,i)=>
        g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.16,10,10), mat(c,{emissive: i===2?c:0x111111, emissiveIntensity: i===2?1:0})), 0,5.55-i*0.42,0.28)));
      put(g, x,0,z); g.rotation.y = rot||0; scene.add(g); solidCircle(x,z,0.25,5.2);
    }
    trafficLight(-17.8,10.4,0.3); trafficLight(-10.2,10.4,-0.3); trafficLight(22,10.2,-0.3);

    // bus stop: shelter on the sidewalk, bus parked at the kerb beside it
    (function busShelter(){
      const g = new THREE.Group();
      g.add(put(box(3.6,2.1,0.1,0x2A3440,{transparent:true, opacity:0.55}), 0,1.15,-0.5));
      g.add(put(box(3.8,0.12,1.5,0x3A4A5C), 0,2.25,0));
      [[-1.7,0.6],[1.7,0.6]].forEach(([px,pz])=> g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,2.2,8), mat(0x3A4A5C)), px,1.1,pz)));
      g.add(put(box(3.2,0.1,0.5,0x3A4048), 0,0.55,0));
      put(g, -4,0,14); scene.add(g); solidBox(-4,14.15,1.95,0.75,2.3,0);
    })();

    // newsstand
    (function newsstand(){
      const g = new THREE.Group();
      g.add(put(box(2.2,2.0,1.4,0x35414D,{roughness:0.7}), 0,1.0,0));
      g.add(put(box(2.6,0.2,1.8,0xE24E30), 0,2.15,0));
      g.add(put(box(2.2,0.7,0.15,0x1B2733,{emissive:0xFFC857, emissiveIntensity:0.15}), 0,1.35,0.72));
      put(g, 24,0,14); scene.add(g); solidBox(24,14,1.3,0.9,2.3,0);
    })();

    // ATM booth, right beside the "bank call" scenario
    (function atmBooth(){
      const g = new THREE.Group();
      g.add(put(box(2.2,2.6,1.6,0x2B3E52,{roughness:0.5}), 0,1.3,0));
      g.add(put(box(1.4,0.9,0.1,0x0C1620,{emissive:0x5FD4D0, emissiveIntensity:0.6}), 0,1.6,0.82));
      g.add(put(box(2.6,0.25,1.9,0x2FA6A1), 0,2.75,0));
      g.add(put(box(1.2,0.5,0.1,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.6}), 0,2.3,0.82));
      put(g, 12.5,0,12.9); scene.add(g); solidBox(12.5,12.9,1.15,0.85,2.9,0);
    })();

    // subway entrance (moved onto the sidewalk so it never blocks the traffic lanes)
    (function subwayEntrance(){
      const g = new THREE.Group();
      g.add(put(box(3.2,0.15,4,0x1D2733), 0,0,0));
      [-1.5,1.5].forEach(sx=> g.add(put(box(0.08,0.9,4,0x8C97A3), sx,0.5,0)));
      g.add(put(box(3.6,0.15,1.2,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.3}), 0,2.0,-1.8));
      [[-1.6,-1.8],[1.6,-1.8]].forEach(([px,pz])=> g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,2,8), mat(0x2A3440)), px,1.0,pz)));
      g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.25,10,10), mat(0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.7})), 0,3.7,-1.8));
      put(g, -27,0,15.5); scene.add(g); solidBox(-27,15.5,1.8,2.1,2.4,0);
    })();

    // café kiosk with two umbrella tables
    (function cafe(){
      const g = new THREE.Group();
      g.add(put(box(3,2.6,2.2,0x5B3A2E,{roughness:0.8}), 0,1.3,0));
      g.add(put(box(3.4,0.2,2.8,0xF4F8F5), 0,2.75,0.3));
      for(let i=0;i<6;i++) g.add(put(box(0.57,0.22,2.8,i%2?0xE24E30:0xF4F8F5), -1.4+i*0.57,2.8,0.3));
      g.add(put(box(2.6,0.9,0.1,0x1B2733,{emissive:0xFFC857, emissiveIntensity:0.35}), 0,1.5,1.12));
      put(g, -33,0,25); scene.add(g); solidBox(-33,25,1.55,1.15,2.9,0);
      [[-29.5,26.5],[-30.3,29.2]].forEach(([tx,tz])=>{
        const t = new THREE.Group();
        t.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,0.1,14), mat(0xE8E2D4)), 0,0.95,0));
        t.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,2.8,8), mat(0xEDEDED)), 0,1.4,0));
        t.add(put(new THREE.Mesh(new THREE.ConeGeometry(1.6,0.8,10), mat(0xFF6B4A)), 0,2.9,0));
        put(t, tx,0,tz); scene.add(t); solidCircle(tx,tz,0.75,1.1);
      });
    })();

    // plaza fountain
    (function fountain(){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(4.5,4.7,0.9,28), mat(0x9A9FA8,{roughness:0.8})), 0,0.45,0));
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(4.1,4.1,0.8,28), mat(0x4DB6D6,{emissive:0x1E7FA0, emissiveIntensity:0.35, roughness:0.2})), 0,0.5,0));
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.7,2.6,12), mat(0x9A9FA8)), 0,1.8,0));
      g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(1.6,0.9,0.5,16), mat(0x9A9FA8)), 0,2.2,0));
      g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.55,12,12), mat(0xBFE9F5,{emissive:0x6FD0EA, emissiveIntensity:0.5})), 0,3.5,0));
      put(g, 30,0,-24); scene.add(g); solidCircle(30,-24,4.7,1.7);
    })();

    // monument in the middle of the plaza
    (function monument(){
      const g = new THREE.Group();
      g.add(put(box(3.2,1.4,3.2,0x8A9099), 0,0.7,0));
      g.add(put(box(2.2,2.4,2.2,0x9AA1AB), 0,2.6,0));
      g.add(put(new THREE.Mesh(new THREE.ConeGeometry(1.1,3.2,4), mat(0xC7A15A,{metalness:0.4, roughness:0.4})), 0,5.4,0));
      put(g, 0,0,-24); scene.add(g); solidBox(0,-24,1.7,1.7,7,0);
    })();

    // food truck in the square
    (function foodTruck(){
      const g = new THREE.Group();
      g.add(put(box(5.6,2.6,2.4,0xFF6B4A,{roughness:0.5}), 0,1.8,0));
      g.add(put(box(1.7,1.9,2.3,0xE24E30), 3.4,1.4,0));
      g.add(put(box(3.2,0.2,1.3,0xF4F8F5), -0.4,3.0,1.6));
      g.add(put(box(3.0,1.1,0.1,0x1B2733,{emissive:0xFFC857, emissiveIntensity:0.4}), -0.4,2.1,1.22));
      [[-1.8,1.2],[-1.8,-1.2],[2.6,1.2],[2.6,-1.2]].forEach(([wx,wz])=> g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,0.35,14), mat(0x111111)), wx,0.45,wz).rotateX(Math.PI/2)));
      put(g, -6,0,-36); g.rotation.y = Math.PI; scene.add(g); addSolid(g, 3.6, 1.3, 3.2);
    })();

    // low planters scattered through the plaza (jump over them if you like)
    [[-22,-20],[22,-12],[-4,-12],[14,-36],[-30,-24]].forEach(([x,z])=>{
      const p = put(box(3,0.9,1.2,0x6B7480), x,0.45,z); scene.add(p);
      scene.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.7,8,8), mat(0x2E7D5B)), x,1.1,z));
      solidBox(x,z,1.55,0.65,0.9,0);
    });

    // ---- vehicles: every one of them is solid ----------------------------------------------------------------
    function parkedCar(x,z,rotY,color){
      const car = new THREE.Group();
      const body = box(4.2,1.2,1.9,color,{roughness:0.4}); put(body, 0,0.9,0); body.castShadow = true; car.add(body);
      car.add(put(box(2.2,0.9,1.7,0xE8EEF2,{roughness:0.3, transparent:true, opacity:0.85}), -0.2,1.75,0));
      [[1.5,0.9],[1.5,-0.9],[-1.5,0.9],[-1.5,-0.9]].forEach(([wx,wz])=>{
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,0.3,14), mat(0x111111));
        wheel.rotation.x = Math.PI/2; put(wheel, wx,0.4,wz); car.add(wheel);
      });
      put(car, x,0,z); car.rotation.y = rotY;
      addSolid(car, 2.1, 0.95, 2.2);
      return car;
    }
    function taxiCar(x,z,rotY){
      const car = parkedCar(x,z,rotY,0xF2C230);
      car.add(put(box(0.7,0.22,0.5,0x1B2A3A,{emissive:0xFFC857, emissiveIntensity:0.6}), -0.2,2.22,0));
      return car;
    }
    function deliveryVan(x,z,rotY,color){
      const van = new THREE.Group();
      const body = box(4.6,2.1,2.0,color,{roughness:0.5}); put(body, 0,1.15,0); body.castShadow = true; van.add(body);
      van.add(put(box(0.1,0.9,1.8,0xBFE3DE,{transparent:true, opacity:0.55}), 2.15,1.9,0));
      van.add(put(box(4.62,0.35,2.02,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.2}), 0,0.5,0));
      [[1.6,0.95],[1.6,-0.95],[-1.6,0.95],[-1.6,-0.95]].forEach(([wx,wz])=>{
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.32,14), mat(0x111111));
        wheel.rotation.x = Math.PI/2; put(wheel, wx,0.42,wz); van.add(wheel);
      });
      put(van, x,0,z); van.rotation.y = rotY;
      addSolid(van, 2.3, 1.0, 2.4);
      return van;
    }
    function cityBus(x,z,rotY){
      const bus = new THREE.Group();
      const body = box(9.5,2.9,2.5,0x2F6B7A,{roughness:0.45}); put(body, 0,1.6,0); body.castShadow = true; bus.add(body);
      bus.add(put(box(9.52,0.9,2.52,0xBFE3DE,{transparent:true, opacity:0.5}), 0,2.35,0));
      bus.add(put(box(9.52,0.4,2.52,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.25}), 0,0.7,0));
      [[3.6,1.3],[3.6,-1.3],[0,1.3],[0,-1.3],[-3.6,1.3],[-3.6,-1.3]].forEach(([wx,wz])=>{
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.35,14), mat(0x111111));
        wheel.rotation.x = Math.PI/2; put(wheel, wx,0.5,wz); bus.add(wheel);
      });
      bus.add(put(box(1.6,0.5,0.1,0x0F2027,{emissive:0xFFC857, emissiveIntensity:0.5}), 4.5,2.35,1.28));
      put(bus, x,0,z); bus.rotation.y = rotY;
      addSolid(bus, 4.75, 1.25, 3.1);
      return bus;
    }
    // parked along the kerb (not in the lanes) and in the square
    scene.add(cityBus(-4,9.3,0));
    scene.add(parkedCar(12,9.4,0,0xB33B2E));
    scene.add(parkedCar(30,9.4,0,0x4A4F5A));
    scene.add(parkedCar(-30,9.4,0,0x2E4A6B));
    scene.add(taxiCar(38,9.4,0));
    scene.add(deliveryVan(-27,-9,0.2,0xE8E2D4));
    scene.add(parkedCar(20,-46,Math.PI,0x8C6D4F));
    scene.add(parkedCar(-36,-46,0,0x5B6B78));

    // ---- moving traffic: two lanes of a boulevard running along the near kerb -----------------------------------
    // every car in a lane has the same speed, keeps its distance, and stops if the sentinel steps in front of it
    function spawnCityTraffic(){
      env.vehicles = [];
      const lanes = [
        {id:'E', z:6.5, dir: 1, speed:6.0, rot:0},
        {id:'W', z:1.5, dir:-1, speed:6.6, rot:Math.PI}
      ];
      const XMIN = -84, XMAX = 84, PER = 6;
      const palette = [0xB33B2E,0x2E4A6B,0x4A4F5A,0x5B6B78,0x8C6D4F,0x3A5A3F,0xD9D4C8];
      lanes.forEach((lane,li)=>{
        for(let i=0;i<PER;i++){
          const kind = (i + li) % 4;
          const car = kind === 1 ? taxiCar(0,0,0) : (kind === 3 ? deliveryVan(0,0,0,0xE8E2D4) : parkedCar(0,0,0,palette[(i*2+li)%palette.length]));
          const x = XMIN + (i + 0.4 + li*0.5) * (XMAX-XMIN)/PER;
          car.position.set(x, 0, lane.z);
          car.rotation.y = lane.rot;                  // the front of every model points along +x, so rot 0 = driving east
          scene.add(car);
          env.vehicles.push({group:car, lane:lane.id, dir:lane.dir, len: kind === 3 ? 4.8 : 4.4, speed:lane.speed, cur:lane.speed, xMin:XMIN, xMax:XMAX});
        }
      });
    }
    spawnCityTraffic();

    // a crowd on the sidewalk and in the square, kept clear of the furniture above
    spawnBystanders(scene, env, [[-30,20],[-4,24],[10,27],[20,22],[-14,26],[-8,22],[-42,-24],[18,-32],[4,-34],[34,-10]], CITY_CHATTER);

    env.sky = null; // no sun orb in the city
  }
},

// ---------------- LEVEL 2: BEACH ----------------
{
  id:'beach', title:'The Shoreline', icon:'🏖️',
  subtitle:'5 scenarios · phishing, baiting & tailgating on the sand',
  objective:'Find and question all 5 visitors on the beach',
  fogColor:0x8FC2BE, fogDensity:0.012,
  // toned down: bright sand under a full sun was blowing out to white
  lightScale:0.8, hemiSky:0xBFE0F0, hemiGround:0xCDAA6D, sunColor:0xFFE5B8,
  landmarks:[
    {name:'Beach Club', x:10, z:-1}, {name:'Lifeguard', x:30, z:-12}, {name:'WiFi Kiosk', x:-22, z:-19.5},
    {name:'Tiki Bar', x:32, z:24}, {name:'Souvenirs', x:-26, z:22}, {name:'Volleyball', x:-32, z:8},
    {name:'Fire Pit', x:-6, z:-26}
  ],
  playerStart:{x:0,z:26}, bounds:{x:46, zMin:-46, zMax:32},
  studs:[{x:0,z:2},{x:32,z:20},{x:-32,z:-4},{x:20,z:28},{x:-12,z:-32}],
  quests:[
    { id:'wifi', name:'The "Free WiFi" Kiosk', pos:{x:-22,z:-16}, color:0xFFC857,
      technique:'Phishing via QR code',
      tip:'Never enter work credentials after scanning an unsolicited QR code — verify the network through an official app or front-desk staff first.',
      scenario:'A cheerful sign reads: "FREE Beach WiFi — Scan & log in with your work email to connect!" The attendant hands you a sticker with a QR code and says it only takes a second.',
      choices:[
        {text:'Scan it and log in with your work email — free WiFi is free WiFi.', correct:false, feedback:'Scanning an unknown QR code and entering work credentials on an unofficial network is exactly how credential-harvesting scams work. A fake login page can capture your password instantly.'},
        {text:'Decline, connect to nothing, and report the kiosk to hotel security.', correct:true, feedback:"Right instinct. Unsolicited QR codes that ask for work credentials are a major red flag — verify through official channels and flag it so others don't get caught."},
        {text:'Say nothing and walk off without reporting it.', correct:false, feedback:"Declining is good, but staying silent means the next guest may fall for it. A quick report to staff helps protect everyone on the beach."}
      ]},
    { id:'lifeguard', name:'The "IT Support" Call', pos:{x:24,z:-10}, color:0xFF6B4A,
      technique:'Vishing / pretexting over the phone',
      tip:"Real IT teams don't ask for your badge number or password over an unexpected call — hang up and call the help desk back on a known number.",
      scenario:'Your phone rings. A calm voice says: "Hi, this is IT Support — we\'re seeing an issue with your account from a device near the resort. Can you confirm your employee badge number so I can lock it down before it locks you out?"',
      choices:[
        {text:'Give the badge number quickly — it sounds urgent and official.', correct:false, feedback:"Urgency and a confident tone are classic pretexting tactics. Legitimate IT staff can verify your identity internally — they don't need you to read out sensitive numbers on an incoming call."},
        {text:'Hang up, then call the IT help desk back using the number from the company directory.', correct:true, feedback:'Exactly right. Never trust caller ID or confidence alone — call back on a number you already know to be genuine before sharing anything.'},
        {text:'Refuse to answer any questions and hang up without following up at all.', correct:false, feedback:'Hanging up was smart, but if there really was an issue, ignoring it entirely leaves it unresolved. Always follow up through a verified channel.'}
      ]},
    { id:'photographer', name:'The "Free Photos" Offer', pos:{x:-6,z:20}, color:0x2FA6A1,
      technique:'Baiting with a USB / device drop',
      tip:'Never plug an unknown USB drive or device into a work laptop — hand it to security or IT instead. "Free" media is a common lure.',
      scenario:'A friendly photographer offers to email you free professional beach photos. "Actually, easier — just plug this little drive into your laptop and I\'ll drag the files over myself, saves us both time."',
      choices:[
        {text:"Plug it in — it's just photos, and it saves time.", correct:false, feedback:'Unknown USB drives are a classic baiting technique — plugging one into your laptop can silently install malware, no email required.'},
        {text:"Ask them to email or airdrop the photos instead, and never plug the drive in.", correct:true, feedback:'Good call. Keeping unknown hardware away from your device removes the risk entirely while still letting you get your photos.'},
        {text:'Take the drive "to be safe" and plug it in later at the office instead.', correct:false, feedback:"The office network isn't a safe testing ground either — an infected drive can compromise it just as easily. Don't use unknown drives at all."}
      ]},
    { id:'tailgater', name:'The Beach Club Door', pos:{x:10,z:8}, color:0xE24E30,
      technique:'Tailgating / piggybacking',
      tip:'Badge-only doors exist for a reason — politely direct people without a badge to the front desk instead of holding the door.',
      scenario:'You badge into the members-only beach club. Someone in a staff-style polo shirt jogs up behind you, arms full of towels, and says: "Ah, forgot my badge again — mind holding the door?"',
      choices:[
        {text:'Hold the door open — their hands are full and they look like staff.', correct:false, feedback:"Looking like staff isn't verification. Tailgating relies on politeness and a plausible costume — holding the door bypasses the whole access-control system."},
        {text:'Let the door close, and point them to the front desk to badge in properly.', correct:true, feedback:"Correct. It feels a little awkward in the moment, but every person should badge in themselves — that's what the system is there to guarantee."},
        {text:'Accuse them loudly of trying to sneak in.', correct:false, feedback:"Staying firm is good, but there's no need for confrontation — a calm redirect to the front desk handles it just as effectively."}
      ]},
    { id:'influencer', name:'The Urgent Gift Card Request', pos:{x:-16,z:14}, color:0xFFC857,
      technique:'Authority + urgency scam (gift-card fraud)',
      tip:'No real executive or vendor will ever ask you to buy gift cards for them — urgency plus authority is the biggest tell of all.',
      scenario:'A text arrives, apparently from your VP: "In back-to-back meetings, can\'t talk. Need you to grab 5 beach-resort gift cards for a client surprise today — send the codes ASAP, will explain later!"',
      choices:[
        {text:"Buy the gift cards right away — the VP said it was urgent.", correct:false, feedback:'Urgency, authority, and an unusual request are the three hallmarks of gift-card fraud. Real leadership requests for purchases go through normal, verifiable channels.'},
        {text:'Pause, and verify the request directly with the VP through a known contact method.', correct:true, feedback:'Exactly the move. A two-second verification call or a message on a separate, known channel stops almost all of these scams cold.'},
        {text:'Forward the text to a few coworkers to ask if it seems normal.', correct:false, feedback:"Asking around is friendlier than nothing, but it doesn't actually confirm the request is real — go straight to the source through a verified channel."}
      ]}
  ],
  buildEnvironment(scene, env){
    const K = levelKit(scene, env, 777);
    const {rnd, mat, box, cyl, sph, cone, put, solidBox, solidCircle, instanced, label, row} = K;
    env.spin = []; env.drift = [];
    const DS = THREE.DoubleSide;

    // ---- sand, damp sand and the water ---------------------------------------------------------
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(320,320), mat(0xD3B176,{roughness:1}));
    sand.rotation.x = -Math.PI/2; sand.receiveShadow = true; scene.add(sand);
    for(let i=0;i<18;i++){
      const r = 4 + rnd()*7;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(r,20), mat(0xC4A164,{roughness:1}));
      patch.rotation.x = -Math.PI/2; patch.position.set((rnd()-0.5)*130, 0.01, -30 + rnd()*66);
      scene.add(patch);
    }
    scene.add(put(box(320,0.02,14,0xA88A58,{roughness:0.8}), 0,0.012,-38));      // damp sand along the water's edge
    scene.add(put(box(320,0.02,5,0x927848,{roughness:0.75}), 0,0.02,-43));

    const oceanGeo = new THREE.PlaneGeometry(300,60,48,48);
    const ocean = new THREE.Mesh(oceanGeo, mat(0x12707F,{roughness:0.35, metalness:0.1, transparent:true, opacity:0.92}));
    ocean.rotation.x = -Math.PI/2; ocean.position.set(0,0.15,-74); scene.add(ocean);
    env.ocean = ocean; env.oceanBase = oceanGeo.attributes.position.array.slice();
    const deepOcean = new THREE.Mesh(new THREE.PlaneGeometry(500,260), mat(0x0B5563));
    deepOcean.rotation.x = -Math.PI/2; deepOcean.position.set(0,-0.1,-170); scene.add(deepOcean);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(280,3), mat(0xF4F8F5,{roughness:0.9, transparent:true, opacity:0.85}));
    foam.rotation.x = -Math.PI/2; foam.position.set(0,0.04,-44); scene.add(foam);

    // ---- sun, clouds and gulls (they animate through env.spin) --------------------------------
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(6,24,24), new THREE.MeshBasicMaterial({color:0xFFDD8A}));
    sunMesh.position.set(-70,55,-110); scene.add(sunMesh);
    const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(11,24,24), new THREE.MeshBasicMaterial({color:0xFFC857, transparent:true, opacity:0.28}));
    sunGlow.position.copy(sunMesh.position); scene.add(sunGlow);
    env.sky = sunGlow;

    const cloudPivot = new THREE.Group(); scene.add(cloudPivot);
    for(let i=0;i<10;i++){
      const ang = i/10*Math.PI*2 + rnd()*0.5, rad = 90 + rnd()*70, y = 52 + rnd()*22;
      const c = new THREE.Group();
      for(let k=0;k<4;k++){
        const puff = sph(5+rnd()*5, 0xFFFFFF, {roughness:1, transparent:true, opacity:0.92, emissive:0xFFFFFF, emissiveIntensity:0.25}, 8);
        puff.position.set(k*6-9+rnd()*3, rnd()*2, rnd()*4); puff.scale.y = 0.55; c.add(puff);
      }
      put(c, Math.cos(ang)*rad, y, Math.sin(ang)*rad); cloudPivot.add(c);
    }
    env.spin.push({obj:cloudPivot, sx:0, sy:0.012, sz:0});
    for(let i=0;i<3;i++){
      const pivot = new THREE.Group(); put(pivot, 0,0,-18); pivot.rotation.y = i*2.1; scene.add(pivot);
      const bird = new THREE.Group();
      bird.add(box(0.5,0.25,0.9,0xF4F8F5));
      const wl = put(box(1.4,0.06,0.5,0xF4F8F5), -0.85,0.1,0); wl.rotation.z = 0.35; bird.add(wl);
      const wr = put(box(1.4,0.06,0.5,0xF4F8F5),  0.85,0.1,0); wr.rotation.z = -0.35; bird.add(wr);
      put(bird, 22+i*4, 18+i*3, 0); bird.rotation.y = Math.PI; pivot.add(bird);
      env.spin.push({obj:pivot, sx:0, sy:0.28+i*0.05, sz:0});
    }

    // ---- distant scenery: islands, a lighthouse, sailboats and a cruise ship ----------------------
    [[-72,-125,34,22,0x5F8A57],[82,-142,46,30,0x4F7A52],[0,-175,60,20,0x6E8F7A]].forEach(([x,z,r,h,c])=> scene.add(put(cone(r,h,c,{roughness:1},9), x,h/2-1,z)));
    (function lighthouse(){
      const g = new THREE.Group();
      g.add(put(cone(9,7,0x7D756B,{roughness:1},8), 0,3.5,0));
      g.add(put(cyl(2.2,3.2,18,0xF4F8F5,null,12), 0,16,0));
      [[11,0xE24E30],[17,0xE24E30]].forEach(([y,c])=> g.add(put(cyl(2.4,2.6,2.2,c,null,12), 0,y,0)));
      g.add(put(cyl(2.4,2.4,2.4,0xFFE6A0,{emissive:0xFFD27A, emissiveIntensity:0.9},12), 0,26.2,0));
      g.add(put(cone(2.9,2.6,0xE24E30,null,12), 0,28.7,0));
      put(g, 62,0,-112); scene.add(g);
    })();
    function sailboat(x,z,c){
      const g = new THREE.Group();
      g.add(put(box(6,1.0,2,0xF4F8F5), 0,0.5,0));
      g.add(put(box(0.18,9,0.18,0x8C6B44), 0,5.5,0));
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.6,7.2), mat(c,{side:DS, roughness:0.8}));
      put(sail, -0.4,5.8,0); g.add(sail);
      put(g, x,0.15,z); scene.add(g);
      env.drift.push({obj:g, base:0.15, speed:0.9, amp:0.18, phase:rnd()*6, spin:0});
    }
    sailboat(-30,-62,0xFFFFFF); sailboat(40,-80,0xFF6B4A); sailboat(10,-96,0xFFC857); sailboat(-62,-88,0x5FD4D0);
    (function cruiseShip(){
      const g = new THREE.Group();
      g.add(put(box(40,5,9,0x2A3E52), 0,2.5,0));
      g.add(put(box(34,6,8,0xF4F8F5), 0,8,0));
      g.add(put(box(18,4,7,0xE9EEF2), 2,13,0));
      g.add(put(cyl(1.4,1.6,4,0xE24E30,null,10), -4,17,0));
      put(g, -100,0.2,-158); scene.add(g);
    })();

    // ---- resort backdrop: boardwalk and hotels behind the beach --------------------------------
    scene.add(put(box(240,0.3,19,0x9C7A52,{roughness:0.9}), 0,0.15,43));                       // boardwalk z 34..52
    const plankLines = [];
    for(let x=-110;x<=110;x+=2.5) plankLines.push({x, y:0.32, z:43});
    scene.add(instanced(new THREE.BoxGeometry(0.06,0.02,19), mat(0x6F5A44), plankLines));
    scene.add(put(box(240,0.8,0.5,0x6F5A44), 0,0.4,33.8));
    const RESORT = [0xF1E9DA,0xE9D8C4,0xF4C7A5,0xCFE5E8,0xE7B8A8,0xBFD9D1,0xF2E2B8];
    row('x', 53, -86, 86, 'N', 12, 26, 10, 13, {shop:true, roof:true, colors:RESORT, lit:0.08, cornice:0xFFFFFF, shopColors:[0xFF6B4A,0x2FA6A1,0xFFC857,0xFF4FA3]});
    row('x', 68, -86, 86, 'N', 28, 58, 12, 16, {roof:true, colors:RESORT, lit:0.08, cornice:0xFFFFFF});
    // boardwalk benches and lamp posts (decoration, outside the walkable area)
    for(let x=-80;x<=80;x+=14){
      const b = new THREE.Group();
      b.add(put(box(2.4,0.12,0.7,0x7A5C44), 0,0.55,0)); b.add(put(box(2.4,0.6,0.1,0x7A5C44), 0,0.95,-0.3));
      put(b, x,0.3,36.2); scene.add(b);
    }
    for(let x=-84;x<=84;x+=18){
      scene.add(put(cyl(0.1,0.13,5,0x2A3440,null,8), x,2.8,38));
      scene.add(put(sph(0.35,0xFFE9B8,{emissive:0xFFDD8F, emissiveIntensity:0.9},8), x,5.4,38));
    }
    // hills to either side, so the sides of the map are never empty
    [-1,1].forEach(sgn=>{
      scene.add(put(cone(46,30,0x5E8F5A,{roughness:1},9), sgn*108,14,-6));
      scene.add(put(cone(34,22,0x6E9A62,{roughness:1},9), sgn*96,10,34));
    });

    // ---- palms ---------------------------------------------------------------------------------------
    function makePalm(x,z,scale,solid){
      const g = new THREE.Group();
      const trunk = cyl(0.32,0.5,7,0x8A6A44,{roughness:0.9},8); put(trunk, 0,3.5,0); trunk.rotation.z = (rnd()-0.5)*0.15; trunk.castShadow = true; g.add(trunk);
      for(let i=0;i<6;i++){
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.55,3.6,4), mat(0x2E7D5B,{roughness:0.8, side:DS}));
        put(frond, 0,7,0); frond.rotation.z = Math.PI/2.1; frond.rotation.y = (i/6)*Math.PI*2; frond.rotation.x = 0.5; frond.castShadow = true; g.add(frond);
      }
      g.add(put(sph(0.28,0x6B4A2B,null,6), 0.3,6.6,0.2)); g.add(put(sph(0.28,0x6B4A2B,null,6), -0.25,6.5,-0.2));
      put(g, x,0,z); g.scale.setScalar(scale); scene.add(g);
      if(solid) solidCircle(x,z,0.5*scale,7*scale);
    }
    [[-42,28],[-40,14],[-44,0],[-40,-14],[-42,-30],[42,28],[40,14],[44,0],[40,-14],[42,-30],
     [-30,30],[-14,31],[2,31],[18,31],[34,30],[-24,-30],[30,-30],[-8,-34],[14,-36],[-38,-38]]
      .forEach(([x,z])=> makePalm(x,z,0.9+rnd()*0.3,true));
    for(let z=-40;z<=44;z+=9){ makePalm(-(52+rnd()*12), z+rnd()*4, 0.9+rnd()*0.4, false); makePalm(52+rnd()*12, z+rnd()*4, 0.9+rnd()*0.4, false); }

    // ---- BEACH CLUB: members-only pavilion with a badge door (the "tailgating" scenario) ---------------
    (function club(){
      const g = new THREE.Group();
      const wall = 0xF2EBDD, glass = {transparent:true, opacity:0.4, roughness:0.1};
      g.add(put(box(14,0.4,7,0xE9DDC7), 0,0.2,0));
      g.add(put(box(14,4.6,0.4,wall), 0,2.5,-3.3));
      [-6.8,6.8].forEach(sx=> g.add(put(box(0.4,4.6,7,wall), sx,2.5,0)));
      g.add(put(box(15.4,0.5,8.4,0x2FA6A1), 0,5.1,0));
      g.add(put(box(15.6,0.2,8.6,0xF4F8F5), 0,5.45,0));
      [-3.8,3.8].forEach(sx=> g.add(put(box(5.2,3.4,0.15,0x9FD3E0,glass), sx,2.1,3.4)));
      [-1.3,1.3].forEach(sx=> g.add(put(box(0.3,3.6,0.3,0x2A3440), sx,2.0,3.4)));
      g.add(put(box(2.9,0.4,0.3,0x2A3440), 0,3.9,3.4));
      g.add(put(box(2.3,3.2,0.12,0x9FD3E0,glass), 0,1.9,3.4));
      g.add(put(box(0.3,0.5,0.12,0xE24E30,{emissive:0xE24E30, emissiveIntensity:0.8}), 1.75,1.5,3.55));
      const sign = label('BEACH CLUB\nMEMBERS ONLY', 7,1.5,{fg:'#FFFFFF', bg:'#124C57', size:0.3}); put(sign, 0,4.55,3.62); g.add(sign);
      [-4,0,4].forEach(lx=> g.add(put(box(1.2,0.35,2.2,0xFFFFFF), lx,0.6,-1.2)));          // loungers inside
      g.add(put(cyl(0.9,0.9,0.1,0xC59A62,null,14), 0,1.1,0.4)); g.add(put(cyl(0.1,0.1,0.9,0x6F5A44,null,6), 0,0.65,0.4));
      put(g, 10,0,-1); scene.add(g);
      solidBox(10,-4.3,7,0.3,5); solidBox(3.2,-1,0.3,3.5,5); solidBox(16.8,-1,0.3,3.5,5);
      solidBox(6.2,2.4,2.6,0.2,3.5); solidBox(13.8,2.4,2.6,0.2,3.5); solidBox(10,2.4,1.2,0.15,3.4);
    })();

    // ---- lifeguard tower (the "IT support call" scenario) ---------------------------------------------------
    (function lifeguard(){
      const g = new THREE.Group();
      [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]].forEach(([x,z])=> g.add(put(cyl(0.15,0.15,3,0x8C6B44,null,8), x,1.5,z)));
      g.add(put(box(3.6,0.2,3.6,0xB89B6A), 0,3.0,0));
      g.add(put(box(3,2.2,3,0xF4F8F5), 0,4.2,0));
      g.add(put(box(2.2,1,0.1,0x9FD3E0,{transparent:true, opacity:0.55}), 0,4.4,-1.52));
      g.add(put(box(3.9,0.3,3.9,0xFF6B4A), 0,5.5,0));
      const cross = label('+',0.9,0.9,{fg:'#E24E30', size:0.9}); put(cross, 0,4.1,1.52); g.add(cross);
      g.add(put(cyl(0.05,0.05,3,0xEDEDED,null,6), 1.6,7,1.5));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.7), mat(0xE24E30,{side:DS})); put(flag, 2.2,8.2,1.5); g.add(flag);
      [-0.55,0.55].forEach(lx=> g.add(put(box(0.08,3,0.08,0x8C6B44), lx,1.5,1.9)));                 // ladder
      for(let i=0;i<6;i++) g.add(put(box(1.1,0.07,0.08,0x8C6B44), 0,0.4+i*0.5,1.9));
      put(g, 30,0,-12); scene.add(g);
      solidBox(30,-12,1.8,1.8,5.5);
    })();
    // lifebuoy stand and swim flags
    (function lifebuoy(){
      const g = new THREE.Group();
      g.add(put(cyl(0.07,0.07,2,0x8C6B44,null,6), 0,1,0));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55,0.16,8,16), mat(0xE24E30)); put(ring, 0,1.7,0.1); g.add(ring);
      put(g, 26,0,-15.5); scene.add(g); solidCircle(26,-15.5,0.3,2);
    })();
    [-8,6,20].forEach((x,i)=>{
      scene.add(put(cyl(0.05,0.05,3,0xEDEDED,null,6), x,1.5,-40));
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.7), mat(i===1?0xFFC857:0xE24E30,{side:DS})); put(f, x+0.6,2.6,-40); scene.add(f);
    });

    // ---- FREE WIFI kiosk (the "QR code" scenario) -------------------------------------------------------------
    (function wifiKiosk(){
      const g = new THREE.Group();
      g.add(put(box(2.6,2.8,1.4,0x2B3E52,{roughness:0.5}), 0,1.4,0));
      const scr = label('FREE\nBeach WiFi\nscan to join', 2.0,1.5,{fg:'#5FD4D0', bg:'#0C1620', size:0.22}); put(scr, -0.2,1.9,0.72); g.add(scr);
      g.add(put(box(3.2,0.25,2,0x2FA6A1), 0,3.0,0));
      g.add(put(box(0.9,0.9,0.05,0xFFFFFF), 0.95,0.85,0.72));                                       // QR sticker
      for(let i=0;i<5;i++) for(let j=0;j<5;j++) if(rnd()<0.55) g.add(put(box(0.14,0.14,0.04,0x111111), 0.95-0.32+i*0.16, 0.85-0.32+j*0.16, 0.76));
      put(g, -22,0,-19.5); scene.add(g); solidBox(-22,-19.5,1.4,0.8,3.2);
    })();

    // ---- tiki bar ----------------------------------------------------------------------------------------------
    (function tikiBar(){
      const g = new THREE.Group();
      [[-3.2,-1.6],[3.2,-1.6],[-3.2,1.6],[3.2,1.6]].forEach(([x,z])=> g.add(put(cyl(0.2,0.24,3.2,0x6F4A2B,null,8), x,1.6,z)));
      const roof = cone(5.4,2.4,0xC9A15A,{roughness:1},4); put(roof, 0,4.4,0); roof.rotation.y = Math.PI/4; g.add(roof);
      g.add(put(box(7,1.15,1.4,0x7A4B2E), 0,0.58,0.8)); g.add(put(box(7.4,0.12,1.7,0xC59A62), 0,1.2,0.8));
      g.add(put(box(6,1.2,0.4,0x5C3B22), 0,2.0,-1.4));
      for(let i=0;i<8;i++) g.add(put(cyl(0.1,0.12,0.5,[0x2FA6A1,0xFF6B4A,0xFFC857,0x8B5CF6][i%4],{roughness:0.3},8), -2.6+i*0.74,2.8,-1.3));
      for(let i=0;i<10;i++) g.add(put(sph(0.12,0xFFE9B8,{emissive:0xFFDD8F, emissiveIntensity:0.9},6), -3.6+i*0.8,3.3,1.7));
      const sgn = label('TIKI BAR', 3.4,0.8,{fg:'#FFC857', bg:'#5C3B22', size:0.5}); put(sgn, 0,3.0,1.75); g.add(sgn);
      [-2.4,-0.8,0.8,2.4].forEach(sx=> g.add(put(cyl(0.32,0.32,0.7,0xFF6B4A,null,10), sx,0.35,2.6)));
      put(g, 32,0,24); scene.add(g);
      solidBox(32,24.8,3.8,0.9,1.3);
      [[-3.2,-1.6],[3.2,-1.6],[-3.2,1.6],[3.2,1.6]].forEach(([x,z])=> solidCircle(32+x,24+z,0.24,3.2));
      [-2.4,-0.8,0.8,2.4].forEach(sx=> solidCircle(32+sx,26.6,0.35,0.75));
    })();

    // ---- volleyball court ----------------------------------------------------------------------------------------
    (function volleyball(){
      const g = new THREE.Group();
      g.add(put(box(18,0.03,10,0xE2C998,{roughness:1}), 0,0.02,0));
      [[0,-5,18,0.12],[0,5,18,0.12],[-9,0,0.12,10],[9,0,0.12,10]].forEach(([x,z,w,d])=> g.add(put(box(w,0.04,d,0xFFFFFF), x,0.05,z)));
      [-8.8,8.8].forEach(x=> g.add(put(cyl(0.12,0.12,2.6,0xEDEDED,null,8), x,1.3,0)));
      const net = new THREE.Mesh(new THREE.PlaneGeometry(17.6,1.1), mat(0xFFFFFF,{side:DS, transparent:true, opacity:0.55})); put(net, 0,2.0,0); g.add(net);
      g.add(put(box(17.6,0.08,0.06,0xFFFFFF), 0,2.55,0));
      g.add(put(sph(0.3,0xFFC857,null,10), -3,0.3,3));
      put(g, -32,0,8); scene.add(g);
      solidCircle(-40.8,8,0.18,2.6); solidCircle(-23.2,8,0.18,2.6);
    })();

    // ---- souvenir shack and the photographer's frame --------------------------------------------------------------
    (function souvenirs(){
      const g = new THREE.Group();
      g.add(put(box(6,3,4,0xE8A672,{roughness:0.9}), 0,1.5,0));
      const roof = cone(4.8,1.8,0xB8924F,{roughness:1},4); put(roof, 0,3.9,0); roof.rotation.y = Math.PI/4; g.add(roof);
      for(let i=0;i<6;i++) g.add(put(box(1.05,0.14,1.4,i%2?0xE24E30:0xF4F8F5), -2.6+i*1.04,2.7,2.5));
      g.add(put(box(4.4,1.1,0.1,0x1B2733,{emissive:0xFFC857, emissiveIntensity:0.3}), 0,1.5,2.02));
      const sgn = label('SOUVENIRS', 4,0.8,{fg:'#FFFFFF', bg:'#8B5CF6', size:0.5}); put(sgn, 0,3.3,2.04); g.add(sgn);
      g.add(put(box(0.6,1.6,0.3,0xE8EEF2), -3.7,0.8,2.4));
      put(g, -26,0,22); scene.add(g); solidBox(-26,22,3.1,2.1,3.2);
    })();
    (function photoFrame(){
      const g = new THREE.Group();
      [-2,2].forEach(x=> g.add(put(cyl(0.1,0.12,3,0x8C6B44,null,8), x,1.5,0)));
      const top = label('SMILE!', 4.6,1.0,{fg:'#FFFFFF', bg:'#FF6B4A', size:0.55}); put(top, 0,3.0,0); g.add(top);
      put(g, -10,0,25); scene.add(g); solidCircle(-12,25,0.15,3); solidCircle(-8,25,0.15,3);
    })();

    // ---- umbrellas, loungers and towels ---------------------------------------------------------------------------
    function umbrella(x,z,c1,c2){
      const g = new THREE.Group();
      g.add(put(cyl(0.09,0.09,3.2,0xEDEDED,null,8), 0,1.6,0));
      for(let i=0;i<8;i++){
        const wedge = new THREE.Mesh(new THREE.ConeGeometry(1.7,1.1,8,1,true,(i/8)*Math.PI*2,Math.PI*2/8), mat(i%2===0?c1:c2,{side:DS}));
        put(wedge, 0,3.2,0); wedge.castShadow = true; g.add(wedge);
      }
      [-1,1].forEach((s,k)=>{ const l = new THREE.Group();
        l.add(put(box(0.9,0.3,2.0,0xF4F8F5), 0,0.3,0)); l.add(put(box(0.9,0.5,0.5,0xF4F8F5), 0,0.55,-0.85)); put(l, s*1.5,0,0.8); g.add(l); });
      g.add(put(box(0.9,0.02,1.7,c1), 2.7,0.03,1.6));
      put(g, x,0,z); scene.add(g);
      solidCircle(x,z,0.14,3.2); solidBox(x-1.5,z+0.8,0.5,1.05,0.55); solidBox(x+1.5,z+0.8,0.5,1.05,0.55);
    }
    umbrella(-12,-3,0xFF6B4A,0xF4F8F5); umbrella(22,-2,0x2FA6A1,0xF4F8F5); umbrella(-4,10,0xFFC857,0xF4F8F5); umbrella(-2,-18,0xFF6B4A,0xFFC857);

    // ---- cabanas near the boardwalk -------------------------------------------------------------------------------
    function cabana(x,z,c){
      const g = new THREE.Group();
      [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]].forEach(([px,pz])=> g.add(put(cyl(0.1,0.1,2.6,0xF4F8F5,null,8), px,1.3,pz)));
      g.add(put(box(3.4,0.2,3.4,c), 0,2.7,0));
      for(let i=0;i<4;i++) g.add(put(box(0.8,0.7,0.06,i%2?0xF4F8F5:c,{side:DS}), -1.2+i*0.8,2.2,1.7));
      g.add(put(box(2.4,0.4,2.2,0xFFFFFF), 0,0.3,0)); g.add(put(box(2.4,0.6,0.4,c), 0,0.7,-0.9));
      put(g, x,0,z); scene.add(g); solidBox(x,z,1.6,1.6,2.8);
    }
    cabana(-18,30.5,0xFF6B4A); cabana(14,30.8,0x2FA6A1); cabana(-34,28,0xFFC857);

    // ---- rocks, boat, surfboards, fire pit, sandcastle ---------------------------------------------------------------
    function rock(x,z,r){
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r,0), mat(0x7D756B,{roughness:1}));
      put(m, x,r*0.6,z); m.scale.set(1,0.8,1.1); m.rotation.y = rnd()*3; m.castShadow = true; scene.add(m);
      solidCircle(x,z,r*0.95,r*1.4);
    }
    [[-43,-37,2.2],[-45,-33,1.4],[-40,-40,1.6],[43,-37,2.4],[45,-33,1.5],[40,-40,1.7],[-46,24,1.6],[46,20,1.8]].forEach(([x,z,r])=> rock(x,z,r));
    (function rowboat(){
      const g = new THREE.Group();
      g.add(put(box(5,0.9,1.9,0xB5482F), 0,0.55,0)); g.add(put(box(4.4,0.2,1.3,0x8C6B44), 0,0.95,0)); g.add(put(box(5.2,0.1,2.1,0xF4F8F5), 0,0.98,0));
      g.add(put(box(0.1,0.1,2.4,0x8C6B44), -0.5,1.2,0));
      put(g, 40,0,-26); g.rotation.y = 0.5; scene.add(g); solidBox(40,-26,2.6,1.0,1.1,0.5);
    })();
    (function surfRack(){
      const g = new THREE.Group();
      g.add(put(box(3.4,0.2,1,0x6F5A44), 0,0.1,0));
      [-1.6,1.6].forEach(x=> g.add(put(box(0.14,1.6,0.14,0x6F5A44), x,0.8,0)));
      [0xFF6B4A,0x2FA6A1,0xFFC857,0x8B5CF6,0xFFFFFF].forEach((c,i)=>{ const b = put(box(0.5,2.4,0.08,c,{roughness:0.3}), -1.3+i*0.65,1.3,0.2); b.rotation.x = -0.12; g.add(b); });
      put(g, -38,0,22); scene.add(g); solidBox(-38,22,1.8,0.6,2.4);
    })();
    (function firePit(){
      const g = new THREE.Group();
      for(let i=0;i<9;i++){ const a = i/9*Math.PI*2; g.add(put(sph(0.3,0x8A8379,{roughness:1},6), Math.cos(a)*1.1,0.2,Math.sin(a)*1.1)); }
      [0,1.1,2.2].forEach(a=>{ const l = put(cyl(0.12,0.12,1.4,0x5C3B22,null,6), 0,0.35,0); l.rotation.z = Math.PI/2; l.rotation.y = a; g.add(l); });
      g.add(put(cone(0.5,1.2,0xFF8A3D,{emissive:0xFF6B2A, emissiveIntensity:0.9},8), 0,0.9,0));
      g.add(put(cone(0.28,0.8,0xFFD27A,{emissive:0xFFC857, emissiveIntensity:1},8), 0,0.8,0));
      put(g, -6,0,-26); scene.add(g); solidCircle(-6,-26,1.3,0.7);
    })();
    (function sandcastle(){
      const g = new THREE.Group();
      const sandMat = 0xE0C58E;
      g.add(put(cyl(1.5,1.6,0.8,sandMat,{roughness:1},12), 0,0.4,0));
      [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([x,z])=>{ g.add(put(cyl(0.45,0.5,1.5,sandMat,{roughness:1},10), x,1.2,z)); g.add(put(cone(0.5,0.6,0xE24E30,null,10), x,2.2,z)); });
      g.add(put(cyl(0.6,0.7,1.6,sandMat,{roughness:1},10), 0,1.6,0));
      put(g, 8,0,-24); scene.add(g); solidCircle(8,-24,1.9,2.2);
    })();

    // ---- bins, a sign and a pier out over the water --------------------------------------------------------------------
    [[-2,28],[26,12],[-36,-10]].forEach(([x,z])=>{ scene.add(put(cyl(0.32,0.28,0.8,0x2B3138,null,10), x,0.4,z)); solidCircle(x,z,0.38,0.85); });
    (function rulesSign(){
      const g = new THREE.Group();
      g.add(put(cyl(0.08,0.08,2.2,0x6F5A44,null,6), 0,1.1,0));
      const s = label('BEACH RULES\nSwim between the flags\nKeep your valuables close', 3.6,1.6,{fg:'#FFFFFF', bg:'#124C57', size:0.2}); put(s, 0,2.4,0); g.add(s);
      put(g, 5,0,28); scene.add(g); solidCircle(5,28,0.2,2.4);
    })();
    (function pier(){
      const g = new THREE.Group();
      g.add(put(box(5,0.3,40,0x8C6B44), 0,1.1,0));
      for(let z=-18;z<=18;z+=4) [-2.3,2.3].forEach(x=>{ g.add(put(cyl(0.22,0.26,4,0x5C3B22,null,8), x,-0.6,z)); });
      [-2.45,2.45].forEach(x=> g.add(put(box(0.1,0.9,40,0x6F5A44), x,1.7,0)));
      g.add(put(box(7,0.25,7,0xC9A15A), 0,4.2,-20)); [[-3,-3],[3,-3],[-3,3],[3,3]].forEach(([x,z])=> g.add(put(cyl(0.15,0.15,3.2,0x6F5A44,null,6), x,2.5,-20+z)));
      g.add(put(cone(5,2,0xC9A15A,{roughness:1},4), 0,5.5,-20));
      put(g, -32,0,-68); scene.add(g);
    })();

    // a crowd of sunbathers, joggers and beach staff, kept clear of the props above
    spawnBystanders(scene, env, [[-22,2],[-9,-9],[18,16],[-4,16],[26,6],[-32,-8],[6,-14],[34,-2]], BEACH_CHATTER,
      {shirts:BEACH_SHIRTS, pants:BEACH_PANTS});
  }
},

// ---------------- LEVEL 3: OFFICE ----------------
{
  id:'office', title:'Inside HQ', icon:'🏢',
  subtitle:'4 scenarios · insider risk, phishing & physical pretexting',
  objective:'Find and question all 4 visitors inside the office',
  // toned down: darker fog + lightScale so the office is no longer blinding white
  fogColor:0x6F7F8C, fogDensity:0.013, lightScale:0.7,
  landmarks:[
    {name:'Server Room', x:16, z:26}, {name:'Breakroom', x:-9, z:22}, {name:'Meeting Room A', x:-26, z:-24},
    {name:'Meeting Room B', x:-11, z:-25}, {name:'Unlocked PC', x:-14, z:-9.5}, {name:'Print Corner', x:26, z:4},
    {name:'Mail Desk', x:16, z:-14}
  ],
  playerStart:{x:0,z:20}, bounds:{x:28, zMin:-26, zMax:24},
  studs:[{x:0,z:4},{x:-18,z:18},{x:22,z:-16},{x:6,z:18}],
  quests:[
    { id:'unlocked', name:'The Unattended Workstation', pos:{x:-14,z:-6}, color:0xFF6B4A,
      technique:'Unlocked-computer opportunism (insider risk)',
      tip:'Lock your screen every time you step away — even for a minute — with Win+L / Ctrl+Cmd+Q.',
      scenario:"You step away from your desk for coffee, screen still unlocked. When you get back, a coworker you don't recognize well is standing near it: \"Oh hey — do you mind if I quickly check something on your machine? Mine's being weird.\"",
      choices:[
        {text:'Sure, let them use your logged-in computer for a minute.', correct:false, feedback:'Letting anyone use a session logged in as you means anything they do is tied to your account — including access to systems only you should touch.'},
        {text:'Politely decline and suggest they contact IT for a loaner or their own login.', correct:true, feedback:"Right approach. It's not rude — it protects both of you, since any activity on your unlocked account is your responsibility."},
        {text:'Let them use it but only for something you can see over their shoulder.', correct:false, feedback:'Watching doesn\'t prevent access to your email, saved passwords, or open sessions in the background — the safest move is simply not sharing your login.'}
      ]},
    { id:'phishmail', name:'The Urgent Invoice Email', pos:{x:10,z:-10}, color:0xFFC857,
      technique:'Phishing email',
      tip:'Hover over sender addresses and links before clicking, and verify unexpected invoices with the vendor through a known contact — not the email itself.',
      scenario:'An email lands in your inbox: "URGENT — Invoice Overdue, Account Will Be Suspended." It\'s from a vendor you\'ve worked with before, but the sender address is spelled slightly differently, and there\'s a button to "Pay Now" with a link.',
      choices:[
        {text:"Click 'Pay Now' quickly so the account doesn't get suspended.", correct:false, feedback:'Urgency plus a slightly-off sender address is a classic phishing pattern. Clicking through could lead to a fake payment portal or malware.'},
        {text:"Don't click anything — contact the vendor directly using a known phone number or portal to verify.", correct:true, feedback:'Exactly right. Verifying independently, through contact info you already trust, sidesteps the entire trap regardless of how convincing the email looks.'},
        {text:'Forward it to a coworker and ask if it looks legit before doing anything.', correct:false, feedback:'Asking around is better than clicking, but it also spreads a potentially malicious link further. Report it to IT/security and verify with the vendor directly instead.'}
      ]},
    { id:'serverroom', name:'The Server Room "Technician"', pos:{x:16,z:18}, color:0x2FA6A1,
      technique:'Pretexting for physical access',
      tip:'Unescorted access to restricted areas requires verified authorization — a badge, a work order, or a call to security, not just a confident manner.',
      scenario:'Someone in a technician\'s polo and a lanyard (no visible photo) is waiting by the server room door: "Hey, I\'m here for the scheduled maintenance — mind letting me in? I left my access card in the van."',
      choices:[
        {text:'Let them in — they clearly know the maintenance schedule.', correct:false, feedback:'Knowing there\'s scheduled maintenance doesn\'t confirm identity — that information could easily be picked up from a conversation or an email overheard elsewhere.'},
        {text:'Ask them to check in with security or your facilities contact to confirm the work order first.', correct:true, feedback:'Correct. Restricted areas should only open for verified, authorized visits — a quick check with security protects the room without being unfriendly.'},
        {text:'Let them in but stay and watch what they do.', correct:false, feedback:"Supervising is better than nothing, but it doesn't verify who they actually are or whether the maintenance is real. Confirm authorization first."}
      ]},
    { id:'eavesdrop', name:'The Breakroom Overheard Call', pos:{x:-9,z:19.5}, patrol:[{x:-9,z:19.5},{x:-6,z:19.5},{x:-6,z:16.5},{x:-9,z:16.5}], color:0xE24E30,
      technique:'Elicitation via eavesdropping / social pressure',
      tip:'Sensitive project details — code names, timelines, client names — shouldn\'t be confirmed to unknown callers, even ones who "already seem to know."',
      scenario:'In the breakroom, your phone rings. The caller casually name-drops your project\'s internal code name and asks: "Hey, quick one — can you just confirm the code name refers to the Meridian account? Client\'s asking and I want to make sure I\'ve got it right before the call."',
      choices:[
        {text:'Confirm it — they already seem to know the code name anyway.', correct:false, feedback:'Already knowing a fragment of information is a common elicitation trick to earn trust — confirming the rest fills in what they were missing.'},
        {text:'Decline to confirm, and offer to loop in your manager or the account owner instead.', correct:true, feedback:"Good call. Redirecting to a verified point of contact keeps sensitive project details from being confirmed to someone whose identity you can't verify."},
        {text:'Give a vague half-answer to seem helpful without fully confirming.', correct:false, feedback:'Even a vague confirmation can validate a guess for someone gathering information piece by piece. It\'s safer to redirect entirely than to hint.'}
      ]}
  ],
  buildEnvironment(scene, env){
    const K = levelKit(scene, env, 4242);
    const {rnd, mat, box, cyl, sph, cone, put, solidBox, solidCircle, instanced, label, row} = K;
    env.spin = [];
    const DS = THREE.DoubleSide;

    // ---- the floor plate (a high-rise floor): matte carpet, nothing glossy ----------------------------
    const slab = put(box(68,1.2,68,0x5E6874,{roughness:0.95}), 0,-0.6,0); slab.receiveShadow = true; scene.add(slab);
    const carpet = put(box(66,0.06,66,0x7C8893,{roughness:1}), 0,0.03,0); carpet.receiveShadow = true; scene.add(carpet);
    const tiles = [];
    for(let i=-8;i<8;i++) for(let j=-8;j<8;j++) if((i+j)%2===0) tiles.push({x:i*4+2, y:0.07, z:j*4+2});
    scene.add(instanced(new THREE.BoxGeometry(4,0.02,4), mat(0x707B87,{roughness:1}), tiles));
    // teal guide tape on the floor: from the entrance towards the work areas
    scene.add(put(box(0.25,0.02,22,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.25}), 0,0.09,6));

    // ---- outer walls: single-sided, so from outside you see straight through them (the camera never gets blocked) ----
    function wallRun(cx,cz,len,rotY){
      const g = new THREE.Group();
      const trim = 0xCBD3D8;
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,1.1), mat(trim,{roughness:0.9})), 0,0.55,0));
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,10), mat(0x9FD3E0,{transparent:true, opacity:0.16, roughness:0.1, metalness:0.2})), 0,6.1,0));
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,1.0), mat(trim,{roughness:0.9})), 0,11.6,0));
      for(let x=-len/2; x<=len/2+0.01; x+=4) g.add(put(box(0.25,10.6,0.4,0x40505C,{roughness:0.5, metalness:0.4}), x,6.1,-0.1));
      put(g, cx,0,cz); g.rotation.y = rotY; scene.add(g);
    }
    wallRun(0,-34,68,0); wallRun(0,34,68,Math.PI); wallRun(-34,0,68,Math.PI/2); wallRun(34,0,68,-Math.PI/2);

    // ---- the city outside the glass ---------------------------------------------------------------------------------
    const SKY = [0x3E4A5C,0x4A5870,0x39475A,0x556379,0x2F3B4E,0x607089];
    const sky = {colors:SKY, lit:0.25, roof:true};
    row('x', 78,-130,130,'N',40,110,14,22,sky); row('x',-78,-130,130,'S',40,110,14,22,sky);
    row('z',-78, -70, 70,'E',40,110,14,22,sky); row('z', 78, -70, 70,'W',40,110,14,22,sky);

    // ---- light fittings: emissive strips (only three real lights, they are expensive) ---------------------------------
    const stripMat = mat(0xFFFFFF,{emissive:0xFFFFFF, emissiveIntensity:0.5});
    for(let i=0;i<4;i++) for(let j=0;j<3;j++) scene.add(put(new THREE.Mesh(new THREE.BoxGeometry(5,0.1,0.5), stripMat), -24+i*16,9.5,-22+j*20));
    [[-14,8.5,-8],[12,8.5,2],[-8,8.5,18]].forEach(([x,y,z])=>{ const l = new THREE.PointLight(0xE8F2FF, 0.35, 22); l.position.set(x,y,z); scene.add(l); });

    // ---- furniture builders -------------------------------------------------------------------------------------------------
    function desk(x,z,rot,screen){
      const g = new THREE.Group();
      g.add(put(box(3,0.12,1.6,0x8C6D4F,{roughness:0.6}), 0,1.1,0));
      [[1.3,0.65],[1.3,-0.65],[-1.3,0.65],[-1.3,-0.65]].forEach(([lx,lz])=> g.add(put(cyl(0.06,0.06,1.1,0x333333,null,8), lx,0.55,lz)));
      const scr = box(1.1,0.7,0.06,0x0C1620,{emissive:0x5FD4D0, emissiveIntensity:0.5}); put(scr, -0.4,1.75,-0.3); g.add(scr);
      g.add(put(box(0.1,0.5,0.1,0x333333), -0.4,1.35,-0.3));
      g.add(put(box(0.9,0.04,0.3,0x2A3440), -0.4,1.18,0.2));                                                  // keyboard
      g.add(put(cyl(0.35,0.35,0.12,0x3A4A5C,null,14), 0,0.75,0.9)); g.add(put(box(0.6,0.7,0.1,0x3A4A5C), 0,1.15,1.2));   // chair
      if(screen){ const t = label(screen,1.0,0.6,{fg:'#7CFFB0', bg:'#0C1620', size:0.22}); put(t, -0.4,1.75,-0.26); g.add(t); }
      put(g, x,0,z); g.rotation.y = rot||0; scene.add(g);
      solidBox(x,z,1.5,0.8,1.25,0);
    }
    // four desks back-to-back with dividers: a typical open-plan cluster
    function cluster(x,z){
      desk(x-1.75,z-1.3,Math.PI); desk(x-1.75,z+1.3,0); desk(x+1.75,z-1.3,Math.PI); desk(x+1.75,z+1.3,0);
      scene.add(put(box(0.1,1.4,4.9,0xCBD3D8), x,0.7,z)); scene.add(put(box(7,1.4,0.1,0xCBD3D8), x,0.7,z));
      solidBox(x,z,0.25,2.45,1.4); solidBox(x,z,3.5,0.5,1.4);          // a bit wider than the thin dividers, so there is no crevice to get stuck in
    }
    [[-24,-4],[-26,6],[4,-18],[20,-22],[22,-4],[2,-28],[-9,4],[11,2]].forEach(([x,z])=> cluster(x,z));

    function plant(x,z){
      const g = new THREE.Group();
      g.add(put(cyl(0.4,0.3,0.5,0x7A4B33,null,10), 0,0.25,0));
      g.add(put(cone(0.6,1.3,0x2E7D5B,null,8), 0,1.1,0)); g.add(put(cone(0.45,1.0,0x3A8E67,null,8), 0,1.9,0));
      put(g, x,0,z); scene.add(g); solidCircle(x,z,0.45,2.4);
    }
    [[-27,22],[27,22],[-27,-24],[27,-24],[0,-24],[-1,13],[18,-12],[-30,0]].forEach(([x,z])=> plant(x,z));

    // ---- the unlocked workstation (insider-risk scenario) -------------------------------------------------------------------------
    desk(-14,-9.5,0,'UNLOCKED\nsigned in: SAM');
    scene.add(put(box(0.25,0.25,0.02,0xFFE066), -14.9,1.7,-9.74)); scene.add(put(box(0.25,0.25,0.02,0xFF8FB1), -14.55,1.5,-9.74));   // sticky notes
    scene.add(put(cyl(0.12,0.1,0.22,0xE8E2D4,null,10), -13.2,1.28,-9.4));                                                          // a coffee mug

    // ---- SERVER ROOM: closed, keypad door (physical-access scenario) -------------------------------------------------------------
    (function serverRoom(){
      const wall = 0xCBD3D8, H = 6;
      scene.add(put(box(6.7,H,0.4,wall), 11.35,H/2,22.4));            // front wall, left of the door
      scene.add(put(box(8.7,H,0.4,wall), 21.65,H/2,22.4));            // front wall, right of the door
      scene.add(put(box(0.4,H,11.6,wall), 8,H/2,28.2));
      scene.add(put(box(0.4,H,11.6,wall), 26,H/2,28.2));
      scene.add(put(box(2.6,3.4,0.2,0x2B3E52,{emissive:0xE24E30, emissiveIntensity:0.35}), 16,1.7,22.4));       // locked door
      scene.add(put(box(0.3,0.5,0.1,0x0C1620,{emissive:0x5FD4D0, emissiveIntensity:0.8}), 17.8,1.5,22.15));     // keypad
      const sign = label('SERVER ROOM\nAUTHORISED ONLY', 5,1.2,{fg:'#FFFFFF', bg:'#B23A28', size:0.28}); put(sign, 16,4.6,22.15); scene.add(sign);
      solidBox(11.35,22.4,3.35,0.25,H); solidBox(21.65,22.4,4.35,0.25,H); solidBox(16,22.4,1.35,0.2,3.4);
      solidBox(8,28.2,0.25,5.8,H); solidBox(26,28.2,0.25,5.8,H);
      // racks with blinking lights (instanced)
      const leds = [], leds2 = [];
      for(let r=0;r<2;r++) for(let i=0;i<8;i++){
        const x = 10.6 + i*2.0, z = 26 + r*4.2;
        scene.add(put(box(1.2,3.4,1.1,0x1B2733), x,1.7,z));
        for(let k=0;k<6;k++) (rnd()<0.75?leds:leds2).push({x:x-0.45+rnd()*0.9, y:0.6+k*0.5, z:z-0.57});
      }
      scene.add(instanced(new THREE.BoxGeometry(0.12,0.06,0.04), mat(0x5FD4D0,{emissive:0x5FD4D0, emissiveIntensity:1}), leds));
      scene.add(instanced(new THREE.BoxGeometry(0.12,0.06,0.04), mat(0xFFC857,{emissive:0xFFC857, emissiveIntensity:1}), leds2));
      scene.add(put(box(18,0.15,0.7,0x56677A), 17,4.2,28));
    })();

    // ---- BREAKROOM (overheard-call scenario): counter, vending machines, tables, fridge -----------------------------------------
    (function breakroom(){
      scene.add(put(box(14,1.1,1.2,0xD9D3C3), -9,0.55,23.2));
      scene.add(put(box(14.2,0.1,1.4,0x56677A), -9,1.15,23.2));
      scene.add(put(box(0.7,0.5,0.6,0x2A3440), -12,1.45,23.2));                                          // coffee machine
      scene.add(put(box(0.7,0.4,0.5,0xB8C0C8), -6,1.4,23.2));                                            // microwave
      [[-15.5,0xD94A3A],[-13.9,0x2F6FB3]].forEach(([x,c])=>{
        scene.add(put(box(1.3,2.4,1.1,c,{roughness:0.5}), x,1.2,22.6));
        scene.add(put(box(0.9,1.4,0.05,0xF4F8F5,{emissive:0xF4F8F5, emissiveIntensity:0.5}), x,1.4,22.02));
      });
      scene.add(put(box(1.2,2.2,1.1,0xE8EEF2), -2.8,1.1,23.2));                                          // fridge
      solidBox(-9,23.2,7.1,0.7,1.3); solidBox(-15.5,22.6,0.65,0.55,2.4); solidBox(-13.9,22.6,0.65,0.55,2.4); solidBox(-2.8,23.2,0.6,0.55,2.2);
      [[-13,17.5],[-4.5,17.2]].forEach(([x,z])=>{
        scene.add(put(cyl(0.9,0.9,0.1,0xE8E2D4,null,16), x,1.0,z)); scene.add(put(cyl(0.1,0.1,1.0,0x56677A,null,8), x,0.5,z));
        [0,1.6,3.2,4.8].forEach(a=> scene.add(put(cyl(0.3,0.3,0.55,0xFF6B4A,null,10), x+Math.cos(a)*1.3,0.28,z+Math.sin(a)*1.3)));
        solidCircle(x,z,0.9,1.1);
      });
      const sn = label('BREAKROOM', 4,0.9,{fg:'#FFFFFF', bg:'#2FA6A1', size:0.5}); put(sn, -9,3.3,23.9); scene.add(sn);
    })();

    // ---- two glass meeting rooms -------------------------------------------------------------------------------------------------
    function glassWall(x,z,w,rot){
      const g = new THREE.Group();
      g.add(put(box(w,4.2,0.1,0x9FD3E0,{transparent:true, opacity:0.3, roughness:0.1}), 0,2.1,0));
      g.add(put(box(w,0.2,0.2,0x40505C), 0,4.2,0)); g.add(put(box(w,0.15,0.2,0x40505C), 0,0.08,0));
      put(g, x,0,z); g.rotation.y = rot||0; scene.add(g);
      if(Math.abs((rot||0)) < 0.1) solidBox(x,z,w/2,0.12,4.2); else solidBox(x,z,0.12,w/2,4.2);
    }
    function meetingRoom(x0,x1,z0,z1,doorX,title,sub){
      const cx = (x0+x1)/2, cz = (z0+z1)/2, w = x1-x0, d = z1-z0;
      glassWall(x0, cz, d, Math.PI/2); glassWall(x1, cz, d, Math.PI/2); glassWall(cx, z0, w, 0);
      const lw = (doorX-1.1) - x0, rw = x1 - (doorX+1.1);                  // front wall (z1) with a door gap
      glassWall(x0+lw/2, z1, lw, 0); glassWall(x1-rw/2, z1, rw, 0);
      scene.add(put(box(Math.min(6,w-3),0.12,2.4,0x6B5240), cx,0.75,cz));
      scene.add(put(box(Math.min(6,w-3)-0.4,0.7,1.8,0x4A3A2E), cx,0.35,cz));
      for(let i=0;i<3;i++) [-1,1].forEach(s=> scene.add(put(box(0.55,0.5,0.55,0x3A4A5C), cx-1.8+i*1.8, 0.5, cz+s*1.7)));
      const scr = label(title+'\n'+sub, 4,1.6,{fg:'#BFE3DE', bg:'#0C1620', size:0.2}); put(scr, cx,2.6,z0+0.15); scene.add(scr);
      solidBox(cx,cz,Math.min(6,w-3)/2,1.2,1.0);
    }
    meetingRoom(-32,-20,-30,-18,-26,'Q4 PLAN','CONFIDENTIAL');
    meetingRoom(-16.5,-5.5,-30,-20,-11,'VENDOR CALL','invoice review');

    // ---- print / mail corner (phishing-email scenario) and the water cooler -----------------------------------------------------------------
    [[25,4],[26.8,4]].forEach(([x,z])=>{
      scene.add(put(box(1.5,1.1,1.1,0xE8EEF2), x,0.55,z)); scene.add(put(box(1.1,0.1,0.8,0x2A3440), x,1.15,z));
      scene.add(put(box(0.5,0.2,0.05,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.7}), x,0.9,z+0.58));
      solidBox(x,z,0.78,0.58,1.2);
    });
    scene.add(put(box(3,1.0,1.2,0xB8924F), 16,0.5,-14));
    const mail = label('MAIL & INVOICES', 3,0.7,{fg:'#FFFFFF', bg:'#8B5CF6', size:0.5}); put(mail, 16,1.8,-14.65); scene.add(mail);
    solidBox(16,-14,1.55,0.62,1.1);
    scene.add(put(box(0.5,1.4,0.5,0xE8EEF2), -22,0.7,13)); scene.add(put(cyl(0.2,0.2,0.5,0x6FC3E8,{transparent:true, opacity:0.7},10), -22,1.65,13)); solidCircle(-22,13,0.4,1.9);

    // ---- walls with whiteboards and screens, a lounge and the entrance/reception wall (outside the walkable area) ---------------------------
    [-20,0,20].forEach((x,i)=>{
      scene.add(put(box(6,3,0.12,0xF4F8F5), x,3.4,-33.8));
      if(i===1){ const s = label('SECURITY\nAWARENESS\nWEEK', 6,3,{fg:'#124C57', bg:'#F4F8F5', size:0.2}); put(s, x,3.4,-33.7); scene.add(s); }
    });
    scene.add(put(box(4,0.9,1.2,0x3C5A6B), 24,0.45,-31.5)); scene.add(put(box(4,0.9,1.2,0x3C5A6B), 28,0.45,-28.5));
    scene.add(put(cyl(0.9,0.9,0.5,0x6B5240,null,14), 25.5,0.25,-29.5));
    for(let i=0;i<4;i++){
      scene.add(put(box(2,4.2,0.25,0x8E9AA4,{metalness:0.8, roughness:0.3}), -9+i*6,2.1,33.6));
      scene.add(put(box(0.6,0.3,0.1,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.8}), -9+i*6,4.6,33.5));
    }
    const logo = label('HALDEN CORP', 12,2,{fg:'#FFFFFF', bg:'#124C57', size:0.5}); put(logo, 0,8.2,33.7); logo.rotation.y = Math.PI; scene.add(logo);
    scene.add(put(box(9,1.1,2,0x27424F), 0,0.55,29));

    // ---- people: coworkers walking between desks and the breakroom ------------------------------------------------------------------------------------
    spawnBystanders(scene, env, [[-4,-12],[-20,12],[6,10],[26,12],[-6,-3],[8,-14]], OFFICE_CHATTER,
      {shirts:OFFICE_SHIRTS, pants:OFFICE_PANTS});
  }
},

// ---------------- LEVEL 4: OFFICE BUILDING (TOWER) ----------------
{
  id:'tower', title:'Northgate Tower', icon:'🏬',
  subtitle:'5 scenarios · lobby access control, badges, drops & after-hours risk',
  objective:'Work the tower lobby and clear all 5 access-control incidents',
  fogColor:0x2E4A5E, fogDensity:0.011, lightScale:0.75,
  landmarks:[
    {name:'Turnstiles', x:0, z:4}, {name:'Reception', x:0, z:-6}, {name:'Lift Bank', x:18.7, z:-17},
    {name:'Security Ops', x:28, z:-20}, {name:'Café', x:31, z:20}, {name:'Visitor Check-in', x:11, z:15},
    {name:'Sofa Lounge', x:-20, z:16}, {name:'Revolving Door', x:0, z:31}
  ],
  playerStart:{x:0,z:26}, bounds:{x:32, zMin:-32, zMax:30},
  studs:[{x:0,z:8},{x:-24,z:20},{x:12,z:-8},{x:-16,z:-24},{x:20,z:22}],
  quests:[
    { id:'badgeclone', name:'The Badge Reader Watcher', pos:{x:-8,z:1.5}, patrol:[{x:-8,z:1.5},{x:-4,z:1.5},{x:-4,z:-1},{x:-8,z:-1}], color:0xFF6B4A,
      technique:'Badge cloning / access-credential capture',
      tip:'Keep your badge shielded and out of sight, and report anyone lingering at a reader with a phone or a reader-shaped device in hand.',
      scenario:'At the turnstiles, a man in a suit stands unusually close behind you with his phone low near your hip pocket. When you badge in he smiles: "Sorry — bad signal in here, just trying to get a bar."',
      choices:[
        {text:'Ignore it, badge through, and carry on to the lift.', correct:false, feedback:'Contactless badges can be read at close range by a concealed device. Someone crowding the reader with hardware near your badge is a physical-access red flag, not a signal problem.'},
        {text:'Step away, badge in with him at a distance, and report it to lobby security.', correct:true, feedback:'Exactly. Creating distance defeats a close-range read, and reporting it lets security review the cameras and warn other staff heading through the gates.'},
        {text:'Ask him to move back, then badge in anyway and forget about it.', correct:false, feedback:'Moving him back helps in the moment, but if he is capturing credentials he will simply try the next person. The report is the part that protects everyone else.'}
      ]},
    { id:'firedrill', name:'The Unscheduled Fire Drill', pos:{x:14,z:-12}, color:0xFFC857,
      technique:'Pretexted evacuation to create unattended access',
      tip:'Evacuations come from building management through known channels — and locking your screen takes one second even when you are leaving in a hurry.',
      scenario:'A man in a hi-vis vest walks the floor: "Surprise drill, everyone out now, leave everything exactly as it is — laptops open, doors propped. Fastest evacuation wins doughnuts."',
      choices:[
        {text:'Leave immediately with everything open — it is a safety drill, speed matters.', correct:false, feedback:'"Leave it all open" is not a fire-safety instruction, it is an attacker clearing the floor. A real drill never requires you to leave sessions unlocked or doors propped.'},
        {text:'Lock your screen, close the secure door behind you, and verify the drill with your floor warden.', correct:true, feedback:'Right balance. You still evacuate — safety first — but locking a screen costs a second and a propped secure door is the exact gap this pretext is trying to create.'},
        {text:'Refuse to move until someone proves the drill is real.', correct:false, feedback:'Never gamble with a possible real evacuation. Leave the floor, but leave it locked, and raise the doubt with a warden or security once you are outside.'}
      ]},
    { id:'liftchat', name:'The Chatty Lift Ride', pos:{x:18,z:12}, color:0x2FA6A1,
      technique:'Shoulder surfing and elicitation in shared space',
      tip:'Lifts, lobbies and cafés are public rooms — assume screens are readable and conversations are audible.',
      scenario:'Riding up, a friendly visitor badge-holder glances at your unlocked phone and says: "Oh, you are on the Halden migration too? Which floor is the project team on — and are they still using the old VPN portal?"',
      choices:[
        {text:'Answer — they have a visitor badge, so they were already cleared by reception.', correct:false, feedback:'A visitor badge means someone signed them in, not that they are cleared for internal project or infrastructure details. Floor numbers and portal names are reconnaissance.'},
        {text:'Turn the phone away, keep it friendly but vague, and point them to reception for directions.', correct:true, feedback:'Well handled. You stayed polite without confirming a project name, a team location, or which systems are in use — the three things that question was fishing for.'},
        {text:'Confirm the floor but refuse to discuss the VPN.', correct:false, feedback:'The floor alone hands an attacker a target and a reason to be there. Directions to internal teams should come from reception, not from a corridor conversation.'}
      ]},
    { id:'usbdrop', name:'The Dropped USB Drive', pos:{x:-18,z:16}, color:0xE24E30,
      technique:'Baiting with removable media',
      tip:'Never plug in found media. Hand it to IT or security unopened — the label is part of the bait.',
      scenario:'A USB stick is lying by the lobby sofa, labelled in marker: "Q4 Redundancies — CONFIDENTIAL". Nobody is around and it is clearly been there a while.',
      choices:[
        {text:'Plug it into your laptop to find the owner — and take a peek at the list.', correct:false, feedback:'Found media is a classic bait. A single drive can install malware the moment it is mounted, and the provocative label exists purely to make you curious enough to plug it in.'},
        {text:'Hand it to IT or security without plugging it in anywhere.', correct:true, feedback:'Exactly right. If the drive is genuinely lost, IT can examine it safely on an isolated machine; if it is bait, you have shut the attack down without touching it.'},
        {text:'Plug it into a spare meeting-room PC instead of your own laptop.', correct:false, feedback:'A meeting-room machine is still on the corporate network — sacrificing a "less important" computer just gives the attacker a quieter foothold.'}
      ]},
    { id:'afterhours', name:'The After-Hours Crew', pos:{x:-14,z:-20}, color:0xFF4FA3,
      technique:'Unescorted access and sensitive-waste exposure',
      tip:'Shred sensitive paper, clear your desk before you leave, and check that after-hours contractors are expected and escorted.',
      scenario:'Working late, you see two people in cleaning uniforms wheeling a bin through the secure wing. One is emptying the confidential-shredding bag into an ordinary rubbish cart while the other photographs a whiteboard "for the maintenance log".',
      choices:[
        {text:'Say nothing — cleaners are here every night and it is not your area.', correct:false, feedback:'Photographing a whiteboard is not cleaning, and confidential waste going into general rubbish is how dumpster diving pays off. Familiar uniforms are easy to buy.'},
        {text:'Call security to verify the crew, and stop the shredding bag going into general waste.', correct:true, feedback:'Correct on both counts. Verification is a two-minute call, and confidential waste belongs in the shredding stream — a bin bag on the kerb is a free intelligence drop.'},
        {text:'Ask them to delete the photo and let them finish up.', correct:false, feedback:'You cannot verify a deletion, and if the crew is not who they claim, you have just told them you noticed. Bring security in rather than handling it alone.'}
      ]}
  ],
  buildEnvironment(scene, env){
    const K = levelKit(scene, env, 9090);
    const {rnd, mat, box, cyl, sph, cone, put, solidBox, solidCircle, instanced, label, row} = K;
    env.spin = [];
    const DS = THREE.DoubleSide;

    // ---- floor: matte stone with inlaid bands, an entrance rug and a compass inlay --------------------------
    const floor = put(box(76,1,72,0x8D98A3,{roughness:0.8}), 0,-0.5,-2); floor.receiveShadow = true; scene.add(floor);
    const seamsX = [], seamsZ = [];
    for(let x=-30;x<=30;x+=10) seamsX.push({x, y:0.03, z:-2});
    for(let z=-30;z<=30;z+=10) seamsZ.push({x:0, y:0.03, z});
    scene.add(instanced(new THREE.BoxGeometry(0.16,0.02,72), mat(0xAAB6C0,{roughness:0.6}), seamsX));
    scene.add(instanced(new THREE.BoxGeometry(76,0.02,0.16), mat(0xAAB6C0,{roughness:0.6}), seamsZ));
    scene.add(put(box(14,0.04,18,0x1F4E5A,{roughness:0.95}), 0,0.04,22));                          // entrance runner rug
    [[7,0x23404C],[5,0x2E5A68],[3,0x23404C]].forEach(([r,c])=> scene.add(put(cyl(r,r,0.03,c,{roughness:0.7},40), 0,0.05+r*0.001,-20)));

    // ---- walls: single-sided, so from outside you see straight through (the camera is never blocked) ----------------
    function wall(cx,cz,len,rot,glass){
      const g = new THREE.Group();
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,1.4), mat(0xB9C2CA,{roughness:0.8})), 0,0.7,0));
      if(glass){
        g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,10.6), mat(0x9FD3E0,{transparent:true, opacity:0.16, roughness:0.1, metalness:0.2})), 0,6.7,0));
        for(let x=-len/2; x<=len/2+0.01; x+=6) g.add(put(box(0.4,11,0.6,0x40505C,{roughness:0.5, metalness:0.5}), x,6.5,-0.2));
      } else {
        g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,10.6), mat(0xA9B3BC,{roughness:0.85})), 0,6.7,0));
        for(let x=-len/2+3; x<=len/2; x+=6) g.add(put(box(0.5,10.6,0.4,0x8E99A3), x,6.7,0.2));
      }
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(len,1.2), mat(0xB9C2CA,{roughness:0.8})), 0,12.4,0));
      put(g, cx,0,cz); g.rotation.y = rot; scene.add(g);
    }
    wall(0,-38,76,0,false); wall(-38,-2,72,Math.PI/2,true); wall(38,-2,72,-Math.PI/2,true);
    wall(0,31,76,Math.PI,true); solidBox(-20.8,31,17.2,0.3,12); solidBox(20.8,31,17.2,0.3,12);

    // ---- the city outside --------------------------------------------------------------------------------------------------------------
    const SKY = [0x34506A,0x3E5E7A,0x2C4660,0x4B6C88,0x3A5570];
    const sky = {colors:SKY, lit:0.3, roof:true};
    row('x', 82,-140,140,'N',40,110,14,22,sky); row('x',-86,-140,140,'S',40,110,14,22,sky);
    row('z',-84, -76, 76,'E',40,110,14,22,sky); row('z', 84, -76, 76,'W',40,110,14,22,sky);

    // ---- revolving door at the entrance (the sentinel starts just inside) ---------------------------------------------------------------
    (function revolving(){
      const g = new THREE.Group();
      g.add(put(cyl(2.5,2.5,0.2,0x2A3440,null,24), 0,3.8,0));
      g.add(put(cyl(2.4,2.4,3.6,0x9FD3E0,{transparent:true, opacity:0.18, roughness:0.1},24), 0,1.9,0));
      const blades = new THREE.Group();
      [0,Math.PI/2].forEach(a=>{ const b = put(box(4.6,3.4,0.1,0xBFE3DE,{transparent:true, opacity:0.45}), 0,1.8,0); b.rotation.y = a; blades.add(b); });
      g.add(blades); put(g, 0,0,31.4); scene.add(g);
      env.spin.push({obj:blades, sx:0, sy:0.5, sz:0});
      [-5,5].forEach(x=>{ scene.add(put(box(2.8,3.4,0.12,0xBFE3DE,{transparent:true, opacity:0.4}), x,1.8,31.2)); scene.add(put(box(0.14,3.6,0.2,0x2A3440), x+(x<0?-1.4:1.4),1.8,31.2)); });
      solidCircle(0,31.4,2.6,3.8);
    })();

    // ---- turnstile barrier across the lobby: lanes for badges, a wide gate for access needs ------------------------------------------------
    // (the glass is only 1.1 tall to look at, but you cannot hop over it)
    (function turnstiles(){
      const Z = 4, glass = {transparent:true, opacity:0.4, roughness:0.1};
      const lanes = [-8,-3,2,7];
      const panels = [[-38,-15.3],[-12.7,-9.3],[-6.7,-4.3],[-1.7,0.7],[3.3,5.7],[8.3,38]];
      panels.forEach(([a,b])=>{
        scene.add(put(box(b-a,1.1,0.12,0x9FD3E0,glass), (a+b)/2,0.55,Z));
        scene.add(put(box(b-a,0.08,0.18,0x40505C), (a+b)/2,1.1,Z));
        solidBox((a+b)/2,Z,(b-a)/2,0.12,3);
      });
      lanes.forEach(c=>{
        [-1.05,1.05].forEach(off=>{
          scene.add(put(box(0.5,1.1,3.2,0x33424E,{roughness:0.5, metalness:0.3}), c+off,0.55,Z));
          scene.add(put(box(0.5,0.1,0.7,0x2FA6A1,{emissive:0x2FA6A1, emissiveIntensity:0.8}), c+off,1.15,Z+0.9));
          solidBox(c+off,Z,0.25,1.6,3);
        });
        scene.add(put(box(0.1,0.9,1.4,0xBFE3DE,{transparent:true, opacity:0.5}), c-0.3,0.6,Z));     // swing flap
      });
      const g1 = label('STAFF BADGE ONLY', 6,0.9,{fg:'#FFFFFF', bg:'#124C57', size:0.5}); put(g1, 2.5,2.7,Z+1.7); scene.add(g1);
      const g2 = label('ASSISTANCE GATE', 2.6,0.8,{fg:'#FFFFFF', bg:'#2F6FB3', size:0.4}); put(g2, -14,2.4,Z+1.7); scene.add(g2);
    })();

    // ---- reception: free-standing logo wall and desk (past the turnstiles) ----------------------------------------------------------------------
    scene.add(put(box(18,8,0.6,0x1B3240,{roughness:0.7}), 0,4,-12));
    scene.add(put(box(11,1.4,0.2,0x5FD4D0,{emissive:0x5FD4D0, emissiveIntensity:0.9}), 0,5.4,-11.6));
    const wl = new THREE.PointLight(0x5FD4D0, 0.8, 22); wl.position.set(0,5.4,-9); scene.add(wl);
    scene.add(put(box(12,1.5,2.6,0x27424F,{roughness:0.55}), 0,0.75,-6)); scene.add(put(box(13,0.2,3.2,0xE8E2D4,{roughness:0.4}), 0,1.6,-6));
    solidBox(0,-12,9,0.4,8); solidBox(0,-6,6.5,1.7,3);
    const rl = label('NORTHGATE TOWER', 12,1.6,{fg:'#FFFFFF', bg:'#124C57', size:0.4}); put(rl, 0,3.0,-11.65); rl.rotation.y = Math.PI; scene.add(rl);

    // ---- lift bank on a wall of its own, with security operations behind it ------------------------------------------------------------------------
    scene.add(put(box(0.8,12,38,0x93A3AF,{roughness:0.75}), 19.2,6,-19));
    [-31,-24,-17,-10,-3].forEach((z,i)=>{
      scene.add(put(box(0.3,6,4.2,0x8E9AA4,{roughness:0.25, metalness:0.85}), 18.7,3,z));
      scene.add(put(box(0.35,6,0.1,0x5A6670), 18.5,3,z));
      scene.add(put(box(0.2,0.5,1.2,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.8}), 18.5,6.6,z));
      const fl = label(['G','3','7','12','21'][i], 0.9,0.5,{fg:'#FFC857', bg:'#0C1620', size:0.7}); put(fl, 18.45,6.9,z); fl.rotation.y = -Math.PI/2; scene.add(fl);
    });
    solidBox(19.2,-19,0.45,19,12);
    // fire alarm and extinguisher beside the evacuation scenario
    scene.add(put(box(0.2,0.5,0.35,0xE24E30,{emissive:0xE24E30, emissiveIntensity:0.3}), 18.6,1.4,-12.4));
    scene.add(put(box(0.25,0.9,0.5,0xC83A28), 18.6,1.2,-14.2));
    const fire = label('FIRE', 0.5,0.3,{fg:'#FFFFFF', size:0.6}); put(fire, 18.45,1.4,-12.4); fire.rotation.y = -Math.PI/2; scene.add(fire);
    (function securityOps(){
      scene.add(put(box(6.4,6,0.4,0xB9C2CA), 22.8,3,-3));                               // south wall, left of the door
      scene.add(put(box(7.2,6,0.4,0xB9C2CA), 34.4,3,-3));                               // south wall, right of the door
      scene.add(put(box(2.8,3.4,0.2,0x2B3E52,{emissive:0x2FA6A1, emissiveIntensity:0.25}), 28,1.7,-3));
      const s = label('SECURITY OPERATIONS', 6,1.1,{fg:'#FFFFFF', bg:'#0C1620', size:0.3}); put(s, 28,4.4,-2.75); scene.add(s);
      solidBox(22.8,-3,3.2,0.25,6); solidBox(34.4,-3,3.6,0.25,6); solidBox(28,-3,1.4,0.2,3.4);
      const scr = [];
      for(let i=0;i<8;i++) scr.push({x:25+i*1.7, y:3.4, z:-37.6});
      scene.add(instanced(new THREE.BoxGeometry(1.4,1.0,0.1), mat(0x0C1620,{emissive:0x5FD4D0, emissiveIntensity:0.6}), scr));
      [-1,1].forEach(k=> scene.add(put(box(7,0.9,1.3,0x3C5A6B), 28+k*4.5,0.45,-30)));
      scene.add(put(box(5,0.8,2.2,0x6B5240), 28,0.4,-18));
    })();

    // ---- public side of the lobby: guard desk, visitor kiosks, queue posts, sofa lounge, cafe ---------------------------------------------------------
    scene.add(put(box(4,1.1,1.4,0x27424F), -26,0.55,9)); scene.add(put(box(3.6,0.7,0.1,0x0C1620,{emissive:0x5FD4D0, emissiveIntensity:0.5}), -26,1.5,8.5));
    solidBox(-26,9,2.1,0.75,1.4);
    [[9.5,15],[12.5,15]].forEach(([x,z])=>{
      scene.add(put(box(0.9,1.6,0.5,0x33424E), x,0.8,z)); scene.add(put(box(0.7,0.5,0.06,0x0C1620,{emissive:0xFFC857, emissiveIntensity:0.5}), x,1.35,z-0.27));
      solidBox(x,z,0.5,0.3,1.7);
    });
    const vk = label('VISITOR CHECK-IN', 3,0.6,{fg:'#FFFFFF', bg:'#2FA6A1', size:0.5}); put(vk, 11,2.4,15.4); scene.add(vk);
    for(let i=0;i<5;i++){
      scene.add(put(cyl(0.12,0.16,1.1,0x44525E,{roughness:0.4, metalness:0.7},10), -4+i*3,0.55,12)); solidCircle(-4+i*3,12,0.16,1.15);
      if(i<4) scene.add(put(box(3,0.12,0.05,0x1F2E38), -2.5+i*3,0.95,12));
    }
    function sofa(x,z,rot){
      const g = new THREE.Group();
      g.add(put(box(4.4,0.5,1.8,0x3C5A6B,{roughness:0.9}), 0,0.7,0)); g.add(put(box(4.4,1.1,0.4,0x33505F,{roughness:0.9}), 0,1.25,-0.7));
      [-1.9,1.9].forEach(sx=> g.add(put(box(0.3,0.7,1.6,0x2A3A45), sx,0.35,0)));
      put(g, x,0,z); g.rotation.y = rot; scene.add(g); solidBox(x,z,2.2,0.9,1.3,rot);
    }
    sofa(-18,12.5,0.35); sofa(-22,19,-0.9);
    scene.add(put(cyl(1.3,1.3,0.16,0x6B5240,{roughness:0.6},16), -20,0.8,17)); scene.add(put(cyl(0.2,0.3,0.8,0x40505C,{roughness:0.6, metalness:0.4},10), -20,0.4,17)); solidCircle(-20,17,1.3,0.9);
    scene.add(put(box(0.28,0.05,0.12,0xE24E30,{emissive:0xE24E30, emissiveIntensity:0.6}), -19.2,0.2,15.2));       // the dropped USB stick
    // cafe along the east wall
    scene.add(put(box(1.4,1.1,10.4,0x5B3A2E), 31,0.55,20)); scene.add(put(box(1.6,0.12,10.6,0xC59A62), 31,1.15,20));
    scene.add(put(box(0.7,0.55,0.7,0x2A3440), 31,1.5,17)); scene.add(put(box(1,2.6,10,0x7A5C44), 37,1.3,20));
    const menu = label('BREW & BYTES\nCoffee · Tea · Wi-Fi', 4.6,1.6,{fg:'#FFC857', bg:'#2A1B12', size:0.24}); put(menu, 36.4,3.6,20); menu.rotation.y = -Math.PI/2; scene.add(menu);
    solidBox(31,20,0.8,5.3,1.3);
    [[25,16.5],[25,20.5],[25,24.5]].forEach(([x,z])=>{
      scene.add(put(cyl(0.8,0.8,0.1,0xE8E2D4,null,16), x,1.0,z)); scene.add(put(cyl(0.1,0.1,1.0,0x56677A,null,8), x,0.5,z));
      [0,2.1,4.2].forEach(a=> scene.add(put(cyl(0.28,0.28,0.55,0x2FA6A1,null,10), x+Math.cos(a)*1.2,0.28,z+Math.sin(a)*1.2)));
      solidCircle(x,z,0.8,1.1);
    });

    // ---- columns, planters, ceiling lights, chandelier rings -------------------------------------------------------------------------------------
    [[-27,-26],[-27,-10],[-27,12],[-9,-26],[-9,14],[9,-26],[9,22]].forEach(([x,z])=>{
      scene.add(put(cyl(0.8,0.9,12,0xC3CCD4,{roughness:0.6},16), x,6,z)); solidCircle(x,z,0.9,12);
    });
    function planter(x,z){
      const g = new THREE.Group();
      g.add(put(cyl(0.9,0.7,1.1,0x53606B,{roughness:0.85},12), 0,0.55,0));
      for(let i=0;i<7;i++){
        const leaf = put(box(0.22,1.7,0.5,0x2E7D52,{roughness:0.9}), (rnd()-0.5)*0.9,1.7+rnd()*0.5,(rnd()-0.5)*0.9);
        leaf.rotation.set((rnd()-0.5)*0.5,rnd()*3,(rnd()-0.5)*0.5); g.add(leaf);
      }
      put(g, x,0,z); scene.add(g); solidCircle(x,z,0.9,2.8);
    }
    [[-34,6],[34,6],[-12,-10],[10,19],[-34,-16],[12,-28]].forEach(([x,z])=> planter(x,z));
    const panels = [];
    for(let x=-24;x<=24;x+=12) for(let z=-24;z<=24;z+=12) panels.push({x, y:11.6, z});
    scene.add(instanced(new THREE.BoxGeometry(6,0.14,2.2), mat(0xFFF6E2,{emissive:0xFFF6E2, emissiveIntensity:0.3}), panels));
    [[0,10.2,-6,3.2],[0,10.2,16,3.2]].forEach(([x,y,z,r],i)=>{
      [r,r*0.62].forEach((rr,k)=>{
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rr,0.1,8,36), mat(0xFFE9B8,{emissive:0xFFD27A, emissiveIntensity:0.8}));
        put(ring, x,y-k*0.5,z); ring.rotation.x = Math.PI/2; scene.add(ring);
        env.spin.push({obj:ring, sx:0, sy:0, sz:(k?-1:1)*0.25});
      });
      scene.add(put(cyl(0.03,0.03,2,0x8C97A3,null,6), x,11.2,z));
    });

    // ---- the after-hours cleaning crew (waste + photographing scenario) and the directory --------------------------------------------------------------
    [[-17.5,-20.6],[-17.5,-18.8]].forEach(([x,z])=>{
      scene.add(put(box(1.2,1.6,1.2,0x3A4A5C,{roughness:0.85}), x,0.8,z));
      scene.add(put(box(1.3,0.12,1.3,0xE24E30,{emissive:0xE24E30, emissiveIntensity:0.25}), x,1.66,z)); solidBox(x,z,0.65,0.65,1.7);
    });
    (function cart(){
      const g = new THREE.Group();
      g.add(put(box(1.3,0.9,0.7,0x2F6FB3), 0,0.75,0)); g.add(put(box(1.4,0.08,0.8,0xCBD3D8), 0,1.25,0));
      g.add(put(cyl(0.35,0.3,0.7,0x2A3440,null,10), -0.45,1.6,0));
      [[-0.55,-0.3],[0.55,-0.3],[-0.55,0.3],[0.55,0.3]].forEach(([x,z])=> g.add(put(cyl(0.12,0.12,0.1,0x111111,null,8), x,0.14,z).rotateX(Math.PI/2)));
      put(g, -9,0,-21); scene.add(g); solidBox(-9,-21,0.75,0.45,1.3);
    })();
    scene.add(put(cone(0.35,0.8,0xFFC857,{emissive:0xFFC857, emissiveIntensity:0.2},3), -12,0.4,-23.5));        // wet floor sign
    scene.add(put(box(5,3.4,0.25,0x1B3240,{roughness:0.7}), -16,2.4,-8)); solidBox(-16,-8,2.5,0.2,3.8);
    for(let r=0;r<5;r++) scene.add(put(box(3.6,0.18,0.08,0x9BB6C2,{emissive:0x9BB6C2, emissiveIntensity:0.25}), -16,3.5-r*0.55,-7.85));

    // ---- the model of the tower on its plinth, and a mezzanine with escalators on the far wall --------------------------------------------------------------
    (function model(){
      const g = new THREE.Group();
      g.add(put(box(4,0.8,4,0x40505C), 0,0.4,0));
      g.add(put(box(1.6,3.4,1.6,0x5FD4D0,{emissive:0x2FA6A1, emissiveIntensity:0.5,transparent:true, opacity:0.85}), 0,2.5,0));
      g.add(put(box(1.0,1.6,1.0,0x8FE3E0,{emissive:0x5FD4D0, emissiveIntensity:0.6}), 0,5.0,0));
      put(g, 0,0,-28); scene.add(g); solidBox(0,-28,2.1,2.1,3);
    })();
    scene.add(put(box(76,0.4,6,0x9AA3AF,{roughness:0.7}), 0,6.0,-35)); scene.add(put(box(76,1.1,0.1,0x9FD3E0,{transparent:true, opacity:0.35}), 0,6.75,-32));
    [-30,30].forEach(x=>{
      const e = put(box(2.4,0.5,9,0x56677A), x,3.1,-33.5); e.rotation.x = 0.55; scene.add(e);
      scene.add(put(box(2.8,0.14,9.2,0x2A3440), x,3.6,-33.5).rotateX(0.55));
      solidBox(x,-33,1.3,3,3.5);
    });
    [-34,0,34].forEach(x=> scene.add(put(cyl(0.5,0.5,6,0xC3CCD4,null,12), x,3,-35)));
    // exit signs
    [[-37.8,3.6,-14],[37.8,3.6,-28],[-37.8,3.6,22]].forEach(([x,y,z])=>{
      const sg = label('EXIT →', 1.8,0.6,{fg:'#FFFFFF', bg:'#1B9E55', size:0.5}); put(sg, x,y,z); sg.rotation.y = x<0 ? Math.PI/2 : -Math.PI/2; scene.add(sg);
    });

    // lobby foot traffic: visitors, couriers and tenants
    spawnBystanders(scene, env, [[-6,22],[10,24],[-26,-2],[26,8],[-26,-4],[4,-18],[-24,-30]], TOWER_CHATTER,
      {shirts:OFFICE_SHIRTS, pants:OFFICE_PANTS});
  }
},

// ---------------- LEVEL 5: THE VOID ----------------
{
  id:'void', title:'The Void', icon:'🌌',
  subtitle:'5 scenarios · deepfakes, MFA fatigue, breached passwords & smishing',
  objective:'Cross the Void and resolve all 5 digital-deception signals',
  fogColor:0x090616, fogDensity:0.019,
  landmarks:[
    {name:'Fake CFO call', x:-12, z:-12.5}, {name:'MFA prompts', x:14, z:-20.5}, {name:'Extension', x:-24.5, z:12},
    {name:'Leaked forum', x:27.5, z:5}, {name:'Parcel SMS', x:-10.5, z:24}, {name:'Padlock', x:-28, z:-26},
    {name:'Core', x:0, z:-2}
  ],
  playerStart:{x:0,z:26}, bounds:{x:34, zMin:-34, zMax:30},
  studs:[{x:0,z:6},{x:-22,z:-14},{x:26,z:14},{x:-26,z:18},{x:16,z:-26}],
  quests:[
    { id:'deepfake', name:'The Face on the Call', pos:{x:-12,z:-8}, color:0x8B5CF6,
      technique:'Deepfake video and voice impersonation',
      tip:'Authorise money and access through your normal approval process, never on the strength of a face or a voice on an unexpected call.',
      scenario:'A video call opens with your CFO, camera on, voice right: "I am between flights and the acquisition is about to leak. Push this payment through now and skip the second approver — I will sign it retroactively."',
      choices:[
        {text:'Push the payment — you can see and hear them, and the urgency is real.', correct:false, feedback:'Convincing synthetic video and cloned voices are cheap now. Seeing a face is no longer proof of identity, and "skip the second approver" is the request an attacker actually needs.'},
        {text:'Refuse to bypass the approval chain and call back on a number you already hold.', correct:true, feedback:'Right. Callback verification on a known number, plus the two-approver rule, defeats this attack even if the deepfake is flawless — the controls do the work, not your eyes.'},
        {text:'Send a smaller test payment first to see whether the request is genuine.', correct:false, feedback:'A part-payment is still an unverified payment, and it confirms to the attacker that the pretext works. Verify identity before any money moves.'}
      ]},
    { id:'mfafatigue', name:'The 3 A.M. Prompts', pos:{x:14,z:-16}, color:0x5FD4D0,
      technique:'MFA fatigue / push bombing',
      tip:'An approval prompt you did not trigger means someone already has your password — deny it, then change the password and tell security.',
      scenario:'Your phone buzzes for the eleventh time overnight: "Approve sign-in?" You have not tried to log in. A message follows from "IT Support": "Please approve to clear the stuck queue so you can work in the morning."',
      choices:[
        {text:'Approve one so the notifications stop and you can sleep.', correct:false, feedback:'That is precisely the goal of push bombing — exhaust you until one tap gets through. A single approval hands over an already-compromised account.'},
        {text:'Deny every prompt, change your password, and report it to security immediately.', correct:true, feedback:'Exactly. The prompts prove your password is already known, so denying is only half the fix — rotating the password and raising the alert closes the door.'},
        {text:'Ignore the prompts and put the phone on silent until morning.', correct:false, feedback:'Silence stops the noise but leaves an attacker hammering a live account all night. Deny, rotate, report — do not just mute it.'}
      ]},
    { id:'extension', name:'The Helpful Extension', pos:{x:-20,z:12}, color:0xFF6B4A,
      technique:'Malicious browser extension / over-permissioned software',
      tip:'Install extensions only from your organisation\'s approved list, and treat "read and change all your data on all websites" as a serious permission.',
      scenario:'A popup while you research: "Install SecureTab Pro — blocks trackers and speeds up your browser. 4.9 stars!" The permission list asks to read and change all your data on every site you visit.',
      choices:[
        {text:'Install it — the reviews are strong and it is in the store.', correct:false, feedback:'Store listings and ratings are routinely faked or bought, and extensions can be sold to new owners who push a malicious update. Those permissions allow reading every session you have open.'},
        {text:'Skip it and ask IT whether an approved equivalent exists.', correct:true, feedback:'Good call. An extension with full read-and-change access on every site can harvest sessions and inject content — IT can supply a vetted option if the need is real.'},
        {text:'Install it in a second browser profile you only use for research.', correct:false, feedback:'A separate profile helps a little, but it still runs on your machine with broad web access — and the "research" profile is often still signed into work accounts.'}
      ]},
    { id:'breachreuse', name:'The Breach Notice', pos:{x:22,z:8}, color:0xFFC857,
      technique:'Credential stuffing after password reuse',
      tip:'Unique passwords per service, kept in a password manager, mean one breach stays one breach.',
      scenario:'A hobby forum you joined years ago has been breached. You used the same password there as on your work email, though your work account has MFA turned on.',
      choices:[
        {text:'Do nothing — MFA on the work account is enough protection.', correct:false, feedback:'MFA is a strong second layer, but attackers stuff breached credentials everywhere and then work on the second factor — via fatigue prompts, SIM swaps or a convincing help-desk call.'},
        {text:'Change the password everywhere it was reused and switch to unique ones in a password manager.', correct:true, feedback:'Right. Rotating the reused password removes the shared key, and unique generated passwords mean the next breach cannot spread beyond the site it happened on.'},
        {text:'Change just the forum password and add a number to the work one.', correct:false, feedback:'Predictable variations are the first thing credential-stuffing tools try. A small tweak to a known password is close to no change at all.'}
      ]},
    { id:'smish', name:'The Delivery Text', pos:{x:-6,z:20}, color:0x2FA6A1,
      technique:'Smishing (SMS phishing)',
      tip:'Track parcels in the carrier\'s official app or site you typed yourself — never through a link in an unexpected text.',
      scenario:'A text arrives: "Your parcel is held — a £1.99 customs fee is outstanding. Pay within 24 hours or it is returned to sender." The link looks close to a real courier\'s domain, and you are expecting a delivery.',
      choices:[
        {text:'Pay the small fee — it is under two pounds and the parcel is real.', correct:false, feedback:'The tiny amount is the trick: it feels too small to question, while the payment page harvests full card details. Expecting a delivery is what makes the timing land.'},
        {text:'Ignore the link and check the parcel in the courier\'s official app or typed-in website.', correct:true, feedback:'Exactly right. Going to the source yourself sidesteps a lookalike domain entirely, and you will see straight away that no fee is owed.'},
        {text:'Open the link to see whether the site looks legitimate before deciding.', correct:false, feedback:'Judging a phishing site by appearance is a losing game — clones are pixel-accurate, and merely loading the page can expose device details or serve a download.'}
      ]}
  ],
  buildEnvironment(scene, env){
    const L = this;
    const K = levelKit(scene, env, 5150);
    const {rnd, mat, box, cyl, sph, cone, put, solidBox, solidCircle, instanced, label} = K;
    env.spin = []; env.drift = [];
    const DS = THREE.DoubleSide;
    const tints = [0x7C5CFF,0x2FA6A1,0xFF4FA3,0xFFC857];

    // places that must stay open: the start, the evidence chips and every quest NPC with its walking loop
    function keepOut(x,z){
      if(Math.hypot(x-L.playerStart.x, z-L.playerStart.z) < 9) return true;
      if(L.studs.some(s=> Math.hypot(x-s.x, z-s.z) < 4)) return true;
      return L.quests.some(q=> Math.hypot(x-(q.pos.x+1.5), z-(q.pos.z+1.5)) < 8);
    }

    // ---- obsidian mirror floor with a glowing lattice and horizon rings ------------------------------------------
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(320,320), mat(0x080716,{roughness:0.22, metalness:0.75}));
    floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(320, 80, 0x7C5CFF, 0x2A1C55);
    grid.position.y = 0.03; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
    [[58,74,0x4C2A8F,0.32],[84,86,0x2FA6A1,0.22],[104,106,0xFF4FA3,0.18]].forEach(([a,b,c,o])=>{
      const ring = new THREE.Mesh(new THREE.RingGeometry(a,b,64), new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:o, side:DS}));
      ring.rotation.x = -Math.PI/2; ring.position.y = 0.05; scene.add(ring);
    });
    // a faint wall of light far out, like a firewall around the whole world
    const wallCyl = new THREE.Mesh(new THREE.CylinderGeometry(120,120,50,64,1,true), new THREE.MeshBasicMaterial({color:0x7C5CFF, transparent:true, opacity:0.07, side:DS}));
    wallCyl.position.y = 25; scene.add(wallCyl);

    // ---- stepping platforms (hex pads) and glowing bridges between a few of them ------------------------------------
    const pads = [];
    for(let i=0;i<16;i++){
      const ang = rnd()*Math.PI*2, rad = 8+rnd()*28;
      const x = Math.cos(ang)*rad, z = Math.sin(ang)*rad;
      const pad = cyl(2.2,2.2,0.12,0x1B1440,{emissive:0x3B2A7A, emissiveIntensity:0.5, transparent:true, opacity:0.8},6);
      put(pad, x,0.08,z); pad.rotation.y = rnd(); scene.add(pad); pads.push({x,z});
    }
    for(let i=0;i+1<pads.length;i+=3){
      const a = pads[i], b = pads[i+1], len = Math.hypot(b.x-a.x,b.z-a.z);
      const br = put(box(0.5,0.1,len,0x7C5CFF,{emissive:0x7C5CFF, emissiveIntensity:0.6, transparent:true, opacity:0.55}), (a.x+b.x)/2,0.09,(a.z+b.z)/2);
      br.rotation.y = Math.atan2(b.x-a.x, b.z-a.z); scene.add(br);
    }

    // ---- monoliths: tilted slabs of broken data. They are solid, and never placed on top of anything important ------
    let placed = 0;
    for(let i=0;i<60 && placed<32;i++){
      const ang = rnd()*Math.PI*2, rad = 18 + rnd()*40;
      const x = Math.cos(ang)*rad, z = Math.sin(ang)*rad;
      const h = 6 + rnd()*16, tint = tints[i%tints.length], tilt = (rnd()-0.5)*0.16, ry = rnd()*Math.PI;
      if(keepOut(x,z) || Math.hypot(x,z+2) < 6) continue;
      const g = new THREE.Group();
      g.add(put(box(2.6,h,0.9,0x140F2C,{roughness:0.35, metalness:0.5}), 0,h/2,0));
      const glyphs = [];
      for(let r=0;r<Math.floor(h/1.4);r++){ if(rnd()<0.3) continue; glyphs.push({x:(rnd()-0.5)*1.4, y:0.9+r*1.4, z:0.48, sx:0.4+rnd()*1.3}); }
      if(glyphs.length){
        const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1,0.3,0.06), mat(tint,{emissive:tint, emissiveIntensity:0.9}), glyphs.length);
        glyphs.forEach((p,k)=>{ const d = new THREE.Object3D(); d.position.set(p.x,p.y,p.z); d.scale.set(p.sx,1,1); d.updateMatrix(); m.setMatrixAt(k,d.matrix); });
        m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; g.add(m);
      }
      put(g, x,0,z); g.rotation.z = tilt; g.rotation.y = ry; scene.add(g);
      solidBox(x,z,1.3,0.45,h,ry); placed++;
    }

    // ---- data crystals: smaller glowing obstacles scattered over the walkable ground ----------------------------------
    let crystals = 0;
    for(let i=0;i<120 && crystals<12;i++){
      const x = (rnd()-0.5)*62, z = -30 + rnd()*58;
      if(keepOut(x,z) || Math.hypot(x,z+2) < 7) continue;
      if(env.solids.some(s=> Math.hypot(x-(s.x||0), z-(s.z||0)) < 5)) continue;           // keep them spread out
      const c = tints[i%4], h = 1.4 + rnd()*1.6;
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.9,0), mat(c,{emissive:c, emissiveIntensity:0.8, transparent:true, opacity:0.9}));
      put(cr, x,h+0.8,z); cr.scale.y = 1.6; scene.add(cr);
      scene.add(put(cyl(0.5,0.6,0.2,0x1B1440,{emissive:c, emissiveIntensity:0.5},8), x,0.1,z));
      env.drift.push({obj:cr, base:h+0.8, speed:0.8, amp:0.25, phase:rnd()*6, spin:0.5});
      solidCircle(x,z,0.6,2.6); crystals++;
    }

    // ---- suspended rings of rotating data and the core pillar of light -------------------------------------------------------
    function dataRing(x,y,z,r,color,tiltX){
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r,0.1,8,48), mat(color,{emissive:color, emissiveIntensity:0.85}));
      put(ring, x,y,z); ring.rotation.x = tiltX; scene.add(ring);
      env.spin.push({obj:ring, sx:0.05, sy:0.22, sz:0.03});
      const l = new THREE.PointLight(color, 0.55, r*5); l.position.set(x,y,z); scene.add(l);
    }
    dataRing(0,9,-6,5.5,0x7C5CFF,Math.PI/2.4); dataRing(-18,7,10,3.4,0x2FA6A1,Math.PI/3);
    dataRing(20,8,-14,4.2,0xFF4FA3,Math.PI/2.2); dataRing(8,11,18,3,0xFFC857,Math.PI/2.6);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.6,26,8,1,true), mat(0x5FD4D0,{emissive:0x5FD4D0, emissiveIntensity:0.7, transparent:true, opacity:0.4, side:DS}));
    put(core, 0,13,-2); scene.add(core); env.spin.push({obj:core, sx:0, sy:0.12, sz:0});
    scene.add(put(cyl(2.6,2.8,0.4,0x1B1440,{emissive:0x3B2A7A, emissiveIntensity:0.6},16), 0,0.2,-2)); solidCircle(0,-2,2.8,12);
    const coreLight = new THREE.PointLight(0x5FD4D0, 1.1, 46); coreLight.position.set(0,7,-2); scene.add(coreLight);

    // ---- gateways: portals with sign boards ----------------------------------------------------------------------------------------
    function gateway(x,z,rot,text,color){
      const g = new THREE.Group();
      [-4,4].forEach(lx=>{ g.add(put(box(1.2,9,1.2,0x140F2C,{roughness:0.35, metalness:0.5}), lx,4.5,0)); g.add(put(box(0.2,8,0.2,color,{emissive:color, emissiveIntensity:0.9}), lx,4.5,0.62)); });
      g.add(put(box(9.6,1.2,1.2,0x140F2C,{roughness:0.35, metalness:0.5}), 0,9.6,0));
      g.add(put(new THREE.Mesh(new THREE.PlaneGeometry(6.8,8.4), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.16, side:DS})), 0,4.4,0));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6,0.08,8,32), mat(color,{emissive:color, emissiveIntensity:0.9})); put(ring, 0,4.4,0); g.add(ring);
      env.spin.push({obj:ring, sx:0, sy:0, sz:0.6});
      const sg = label(text, 7.4,1.6,{fg:'#FFFFFF', bg:'#140F2C', size:0.42}); put(sg, 0,11.2,0); g.add(sg);
      put(g, x,0,z); g.rotation.y = rot; scene.add(g);
      const c = Math.cos(rot), s = Math.sin(rot);
      [-4,4].forEach(lx=> solidBox(x+lx*c, z-lx*s, 0.6,0.6,9, rot));
    }
    gateway(-31,-4,Math.PI/2,'ACCESS DENIED',0xFF4FA3); gateway(31,-2,-Math.PI/2,'VERIFY NOW',0xFFC857); gateway(0,-31,0,'URGENT!',0x2FA6A1);

    // ---- floating browser windows: look-alike log-in pages (decoration high above the ground) ---------------------------------------------------
    [[-36,-14,'https://paypa1-secure.com\n! NOT SECURE\nEnter your password'],[36,12,'https://micr0soft-login.net\n! NOT SECURE\nVerify your account'],
     [-30,26,'https://bank-alert.co\n! NOT SECURE\nConfirm your PIN'],[24,-34,'https://dr0pbox-share.io\n! NOT SECURE\nSign in to view file'],
     [-8,-38,'https://delivery-fee.top\n! NOT SECURE\nPay £1.99 now']].forEach(([x,z,txt],i)=>{
      const g = new THREE.Group();
      g.add(put(box(8.4,5.4,0.2,0x1B1440,{emissive:0x241A5A, emissiveIntensity:0.5}), 0,0,0));
      g.add(put(box(8.4,0.7,0.24,0x3B2A7A), 0,2.35,0));
      [-3.6,-3.1,-2.6].forEach((dx,k)=> g.add(put(sph(0.14,[0xFF4FA3,0xFFC857,0x2FA6A1][k],{emissive:[0xFF4FA3,0xFFC857,0x2FA6A1][k], emissiveIntensity:0.8},8), dx,2.35,0.16)));
      const face = label(txt, 7.8,4.2,{fg:'#FF8FB1', bg:'#1B1440', size:0.16}); put(face, 0,-0.4,0.14); g.add(face);
      put(g, x,10+(i%3)*1.5,z); g.rotation.y = Math.atan2(-x,-z); scene.add(g);
      env.drift.push({obj:g, base:g.position.y, speed:0.4+rnd()*0.3, amp:0.5, phase:rnd()*6, spin:0});
    });

    // ---- a prop beside every scenario, so each one has something to look at -----------------------------------------------------------------------------
    function stage(x,z,c){ scene.add(put(cyl(1.3,1.3,0.18,0x1B1440,{emissive:c, emissiveIntensity:0.5},14), x,0.1,z)); }
    function propBoard(x,z,text,c,w,h){
      stage(x,z,c);
      const g = new THREE.Group();
      g.add(put(box(w+0.3,h+0.3,0.2,0x140F2C,{emissive:c, emissiveIntensity:0.3}), 0,0,0));
      g.add(put(label(text, w,h,{fg:'#FFFFFF', bg:'#0C0A1E', size:0.2}), 0,0,0.12));
      put(g, x,3.2,z); scene.add(g);
      env.drift.push({obj:g, base:3.2, speed:0.7, amp:0.2, phase:rnd()*6, spin:0});
      scene.add(put(cyl(0.08,0.08,2.4,c,{emissive:c, emissiveIntensity:0.8},6), x,1.2,z));
      solidCircle(x,z,1.0,3);
    }
    propBoard(-12,-12.5,'CFO · LIVE\n"push the payment now,\nskip the 2nd approver"',0x8B5CF6,5.2,3);
    propBoard(14,-20.5,'Approve sign-in?\n[ YES ]    [ NO ]\n(11th prompt tonight)',0x5FD4D0,4.4,3);
    propBoard(-24.5,12,'SecureTab Pro (5/5)\nrequests: read and change\nALL your data on ALL sites',0xFF6B4A,5.2,3);
    propBoard(27.5,5,'forum.hobby: LEAKED\n3,204,118 passwords\nreused anywhere?',0xFFC857,4.8,3);
    propBoard(-10.5,24,'SMS: Your parcel is held\nPay £1.99 within 24h:\nhttp://dhl-fee.top',0x2FA6A1,4.8,3);

    // padlock monument
    (function padlock(){
      const g = new THREE.Group();
      g.add(put(box(3.2,2.8,1.4,0x3B2A7A,{emissive:0x7C5CFF, emissiveIntensity:0.5, roughness:0.4}), 0,1.4,0));
      const sh = new THREE.Mesh(new THREE.TorusGeometry(1.0,0.22,10,24,Math.PI), mat(0xC9B8FF,{emissive:0x9C8CFF, emissiveIntensity:0.6, metalness:0.6})); put(sh, 0,2.8,0); g.add(sh);
      g.add(put(cyl(0.22,0.22,0.1,0x0C0A1E,null,12), 0,1.5,0.72).rotateX(Math.PI/2)); g.add(put(box(0.18,0.7,0.1,0x0C0A1E), 0,1.1,0.72));
      put(g, -28,0,-26); scene.add(g); solidCircle(-28,-26,2.2,3.5);
    })();

    // ---- server spires on the horizon, data streams and floating islands (all far from the walkable area) -----------------------------------------------
    for(let i=0;i<14;i++){
      const ang = i/14*Math.PI*2 + rnd()*0.2, rad = 66 + rnd()*10, h = 30 + rnd()*30, c = tints[i%4];
      const g = new THREE.Group();
      g.add(put(box(2.2,h,2.2,0x140F2C,{roughness:0.4, metalness:0.5}), 0,h/2,0));
      for(let k=0;k<5;k++) g.add(put(box(2.4,0.35,2.4,c,{emissive:c, emissiveIntensity:0.9}), 0,6+k*(h-10)/4,0));
      put(g, Math.cos(ang)*rad, 0, Math.sin(ang)*rad); scene.add(g);
    }
    for(let i=0;i<18;i++){
      const ang = rnd()*Math.PI*2, rad = 14+rnd()*44, x = Math.cos(ang)*rad, z = Math.sin(ang)*rad, c = tints[i%4];
      if(keepOut(x,z)) continue;
      scene.add(put(cyl(0.12,0.12,50,c,{emissive:c, emissiveIntensity:0.8, transparent:true, opacity:0.35},6), x,25,z));
    }
    for(let i=0;i<5;i++){
      const ang = i/5*Math.PI*2+0.4, rad = 70 + rnd()*24, y = 12 + rnd()*10;
      const g = new THREE.Group();
      g.add(put(cyl(7,6,1.6,0x1B1440,{emissive:0x3B2A7A, emissiveIntensity:0.5},6), 0,0,0));
      g.add(put(cone(6,7,0x140F2C,{roughness:0.6},6), 0,-4.3,0).rotateX(Math.PI));
      g.add(put(box(2,2,2,tints[i%4],{emissive:tints[i%4], emissiveIntensity:0.8}), 0,1.8,0));
      put(g, Math.cos(ang)*rad, y, Math.sin(ang)*rad); scene.add(g);
      env.drift.push({obj:g, base:y, speed:0.25+rnd()*0.2, amp:1.2, phase:rnd()*6, spin:0});
    }

    // ---- drifting shards (corrupted packets) and the star field ---------------------------------------------------------------------------------------------------
    for(let i=0;i<64;i++){
      const s = 0.25 + rnd()*0.7, c = tints[Math.floor(rnd()*4)];
      const shard = box(s,s,s,c,{emissive:c, emissiveIntensity:0.6, transparent:true, opacity:0.85});
      put(shard, (rnd()-0.5)*90, 1+rnd()*22, (rnd()-0.5)*90); scene.add(shard);
      env.drift.push({obj:shard, base:shard.position.y, speed:0.3+rnd()*0.8, amp:0.6+rnd()*1.6, phase:rnd()*6.28, spin:0.4+rnd()});
    }
    const starPos = new Float32Array(700*3);
    for(let i=0;i<700;i++){
      const r = 90 + rnd()*60, th = rnd()*Math.PI*2, ph = rnd()*Math.PI*0.5;
      starPos[i*3] = Math.cos(th)*Math.sin(ph)*r; starPos[i*3+1] = Math.cos(ph)*r*0.7 + 8; starPos[i*3+2] = Math.sin(th)*Math.sin(ph)*r;
    }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({color:0xC9B8FF, size:0.9, transparent:true, opacity:0.75}));
    scene.add(stars); env.spin.push({obj:stars, sx:0, sy:0.006, sz:0});

    env.sky = null;
  }
}

];

let currentUser = null;
let runActive = false;
let runState = { coins:0, timed:true, lives:3, timeLeft:0 };
let playerSpot = null, playerSpotTarget = null;

// ======================================================
// CHARACTER CUSTOMIZATION
// ======================================================
const SKIN_COLORS = [0xFFCB4C,0xF4C9A0,0xE8A672,0xC17B4D,0x8D5A3B,0x5C3A28];
const HAIR_COLORS = [0x2B1B12,0x000000,0x6B4423,0xB8860B,0xC0C0C0,0xE24E30,0x2FA6A1,0x8B5CF6];
const SHIRT_COLORS = [0xFFC857,0xFF6B4A,0x2FA6A1,0xE24E30,0x5FD4D0,0xF4F8F5,0x8B5CF6,0xFF4FA3];
const PANTS_COLORS = [0x1B2A3A,0x33383F,0x3A4A5C,0x0B5563,0x2E3A4D,0x5C1F1F];
const BADGE_COLORS = [0x2FA6A1,0xFFC857,0xFF6B4A,0xF4F8F5,0x5FD4D0,0xE24E30];

// themed outfit palettes so background people dress like they belong to each setting
const BEACH_SHIRTS  = [0xFF6B4A,0xFFC857,0x2FA6A1,0xFF4FA3,0x5FD4D0,0xF4F8F5,0xE8A672];
const BEACH_PANTS   = [0xEFD9A6,0xD9BD82,0x1B2A3A,0xF4F8F5,0x3A4A5C];
const OFFICE_SHIRTS = [0x2E3A4D,0x3A4A5C,0xF4F8F5,0x1B2A3A,0x5FD4D0,0x8C97A3,0xCBD3D8];
const OFFICE_PANTS  = [0x1B2A3A,0x33383F,0x0B5563,0x2E3A4D,0x3A4A5C];
const DEFAULT_CHARACTER = { skin:0xFFCB4C, face:'round', hair:'short', hairColor:0x2B1B12, shirt:0xFFC857, pants:0x1B2A3A, badge:0x2FA6A1, name:'' };
let currentCharacter = Object.assign({}, DEFAULT_CHARACTER);
let customizeOpen = false;
let previewRenderer=null, previewScene=null, previewCamera=null, previewFigure=null, previewAnimId=null;

function initPreviewScene(){
  const canvas = document.getElementById('preview-canvas');
  previewRenderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  previewScene = new THREE.Scene();
  previewCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  previewCamera.position.set(0,1.55,4.1);
  previewCamera.lookAt(0,1.05,0);
  const hemi = new THREE.HemisphereLight(0xFFE1A8,0x223344,1.05); previewScene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff,0.85); dir.position.set(2,4,3); previewScene.add(dir);
}
function resizePreview(){
  if(!previewRenderer) return;
  const canvas = previewRenderer.domElement;
  const size = canvas.clientWidth || 180;
  previewRenderer.setSize(size, size, false);
  previewCamera.aspect = 1;
  previewCamera.updateProjectionMatrix();
}
function rebuildPreviewFigure(){
  if(previewFigure){ previewScene.remove(previewFigure); }
  previewFigure = makeLegoFigure(currentCharacter.shirt, currentCharacter.pants, currentCharacter.skin, currentCharacter.face, currentCharacter.hair, currentCharacter.hairColor);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.22,0.03), new THREE.MeshStandardMaterial({color:currentCharacter.badge, emissive:currentCharacter.badge, emissiveIntensity:0.4}));
  badge.position.set(0.2,1.32,0.21); previewFigure.add(badge);
  previewScene.add(previewFigure);
}
function animatePreview(){
  if(!customizeOpen){ previewAnimId = null; return; }
  previewAnimId = requestAnimationFrame(animatePreview);
  if(previewFigure) previewFigure.rotation.y += 0.012;
  previewRenderer.render(previewScene, previewCamera);
}
function buildSwatchRow(containerId, colors, key){
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  colors.forEach(c=>{
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = '#' + c.toString(16).padStart(6,'0');
    sw.dataset.color = c;
    sw.onclick = ()=>{
      currentCharacter[key] = c;
      const slot = key === 'shirt' ? 'outfit' : (key === 'badge' ? 'badge' : null);
      if(slot && userData && userData.inventory.equipped[slot]){
        userData.inventory.equipped[slot] = null;
        saveUser();
      }
      refreshSwatchSelection();
      rebuildPreviewFigure();
    };
    el.appendChild(sw);
  });
}
const FACE_SHAPES = [['round','◯ Round',0x5FD4D0],['square','◻ Square',0xFF6B4A],['long','▯ Long',0xFFC857]];
function buildFaceOptions(){
  const el = document.getElementById('face-options');
  el.innerHTML = '';
  FACE_SHAPES.forEach(([id,label,accent])=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    const hex = '#' + accent.toString(16).padStart(6,'0');
    btn.style.cssText = `width:auto; height:32px; padding:0 12px; border-radius:10px; background:${hex}22; border-color:${hex}88; color:var(--foam); font-size:12px; font-family:'Fredoka',sans-serif; white-space:nowrap;`;
    btn.textContent = label;
    btn.dataset.face = id;
    btn.onclick = ()=>{
      currentCharacter.face = id;
      refreshSwatchSelection();
      rebuildPreviewFigure();
    };
    el.appendChild(btn);
  });
}
const HAIR_STYLES = [['none','✕ Bald',0x8C97A3],['short','◠ Short',0xB0A18C],['long','~ Long',0xFF4FA3],['mohawk','▲ Mohawk',0x8B5CF6]];
function buildHairOptions(){
  const el = document.getElementById('hair-options');
  el.innerHTML = '';
  HAIR_STYLES.forEach(([id,label,accent])=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    const hex = '#' + accent.toString(16).padStart(6,'0');
    btn.style.cssText = `width:auto; height:32px; padding:0 12px; border-radius:10px; background:${hex}22; border-color:${hex}88; color:var(--foam); font-size:12px; font-family:'Fredoka',sans-serif; white-space:nowrap;`;
    btn.textContent = label;
    btn.dataset.hair = id;
    btn.onclick = ()=>{
      currentCharacter.hair = id;
      refreshSwatchSelection();
      rebuildPreviewFigure();
    };
    el.appendChild(btn);
  });
}
function refreshSwatchSelection(){
  [['skin-swatches','skin'],['shirt-swatches','shirt'],['pants-swatches','pants'],['badge-swatches','badge'],['hair-color-swatches','hairColor']].forEach(([id,key])=>{
    const el = document.getElementById(id);
    [...el.children].forEach(sw=>{
      sw.classList.toggle('selected', Number(sw.dataset.color) === currentCharacter[key]);
    });
  });
  const faceEl = document.getElementById('face-options');
  if(faceEl) [...faceEl.children].forEach(btn=>{
    btn.classList.toggle('selected', btn.dataset.face === currentCharacter.face);
  });
  const hairEl = document.getElementById('hair-options');
  if(hairEl) [...hairEl.children].forEach(btn=>{
    btn.classList.toggle('selected', btn.dataset.hair === currentCharacter.hair);
  });
}
function showCustomizeScreen(opts){
  opts = opts || {};
  customizeOpen = true;
  authOverlay.classList.add('hidden');
  hubOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  if(!opts.fromPause) setGameChromeVisible(false); // mid-run, leave the HUD as-is behind the pause card
  document.getElementById('customize-overlay').classList.remove('hidden');
  document.getElementById('character-name').value = currentCharacter.name || '';
  if(!previewRenderer) initPreviewScene();
  resizePreview();
  buildSwatchRow('skin-swatches', SKIN_COLORS, 'skin');
  buildFaceOptions();
  buildHairOptions();
  buildSwatchRow('hair-color-swatches', HAIR_COLORS, 'hairColor');
  buildSwatchRow('shirt-swatches', SHIRT_COLORS, 'shirt');
  buildSwatchRow('pants-swatches', PANTS_COLORS, 'pants');
  buildSwatchRow('badge-swatches', BADGE_COLORS, 'badge');
  refreshSwatchSelection();
  rebuildPreviewFigure();
  if(previewAnimId===null) animatePreview();
  document.getElementById('customize-confirm-btn').textContent = opts.fromPause ? 'Save & Return →' : 'Enter the Field →';
  document.getElementById('customize-confirm-btn').onclick = ()=> confirmCustomize(opts.fromPause);
}
function confirmCustomize(fromPause){
  currentCharacter.name = document.getElementById('character-name').value.trim().slice(0,18);
  if(currentUser && userData){
    userData.character = currentCharacter;
    saveUser();
  }
  customizeOpen = false;
  document.getElementById('customize-overlay').classList.add('hidden');
  if(previewAnimId){ cancelAnimationFrame(previewAnimId); previewAnimId = null; }

  if(fromPause && player){
    const pos = player.position.clone();
    const rotY = player.rotation.y;
    buildPlayer();
    player.position.copy(pos);
    player.rotation.y = rotY;
    player.userData.baseRotY = rotY;
    openPause();
  } else {
    showHub();
  }
}
document.getElementById('hub-customize-btn').onclick = ()=> showCustomizeScreen({fromPause:false});
window.addEventListener('resize', ()=>{ if(customizeOpen) resizePreview(); });

// ======================================================
// ACCOUNT SESSION
// All saved data is handled by js/database.js (SecurityQuestDB).
// This section only keeps the signed-in user in memory and passes
// them to the database when it is time to save.
// ======================================================
const DB = SecurityQuestDB;
DB.init({ levelIds: LEVELS.map(l=>l.id) });
// told about online-save problems (offline, blocked by rules...) so the player is not left guessing
DB.onSyncStatus = (state, msg)=>{
  if(state === 'error') toast('warn','Could not save online', (msg || 'Check your connection.') + ' Your progress is kept and will retry.', 5000);
};
const DIFF_IDS = DB.DIFF_IDS;
const emptyStage = DB.emptyStage;
const makeNote = DB.makeNote;

function esc(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// one shared diamond icon for every credit amount (HUD, hub, shop, payout, toasts)
const GEM_HTML = '<span class="gem"></span>';
function gem(n){ return GEM_HTML + n; }
function withGems(str){ return String(str).replace(/◈/g, GEM_HTML); }

let userData = null;
function saveUser(){
  if(!currentUser || !userData) return;
  DB.saveUser(currentUser, userData);
}
function stageRecord(levelId, diffId){ return DB.stageRecord(userData, levelId, diffId); }
function isLevelUnlocked(i){ return DB.isLevelUnlocked(userData, i); }
function isLevelCleared(i){ return DB.isLevelCleared(userData, i); }


// ======================================================
// LOADING SCREEN
// ======================================================
const LOADING_TIPS = [
  'Verification beats intuition. Call back on a number you already have.',
  'A uniform, a lanyard and a confident story are the cheapest props an attacker can buy.',
  'Urgency is the tell. Every pretext needs you to act before you think.',
  'Lock your screen when you stand up — even for the length of a coffee run.',
  'Unique passwords mean one breach stays one breach.',
  'An approval prompt you did not trigger means someone already has your password.',
  'Found USB drives are bait. Hand them to IT unopened.',
  'You can be helpful and still say "let me check that first".'
];
let loadingTimer = null;
function showLoading(title, sub, duration, done){
  const ov = document.getElementById('loading-overlay');
  const fill = document.getElementById('loading-fill');
  document.getElementById('loading-title').textContent = title;
  document.getElementById('loading-sub').textContent = sub;
  document.getElementById('loading-tip').innerHTML =
    '<b>Field note</b> &nbsp;' + esc(LOADING_TIPS[Math.floor(Math.random()*LOADING_TIPS.length)]);
  ov.classList.remove('hidden','fading');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  void fill.offsetWidth;
  fill.style.transition = 'width ' + duration + 'ms cubic-bezier(.3,.7,.4,1)';
  fill.style.width = '100%';
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(()=>{
    if(done) done();
    ov.classList.add('fading');
    setTimeout(()=>{ ov.classList.add('hidden'); }, 340);
  }, duration);
}

// ======================================================
// TOASTS + NOTIFICATION LOG
// ======================================================
const TOAST_ICONS = { success:'✅', info:'ℹ️', reward:'◈', warn:'⚠️', shop:'🛍️' };
function toast(type, title, body, ms){
  const stack = document.getElementById('toast-stack');
  if(!stack) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  el.innerHTML = '<div class="t-icon">' + withGems(TOAST_ICONS[type] || 'ℹ️') + '</div>' +
    '<div class="t-body"><b>' + withGems(esc(title)) + '</b>' + (body ? '<span>' + withGems(esc(body)) + '</span>' : '') + '</div>';
  stack.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('in'));
  setTimeout(()=>{
    el.classList.remove('in');
    setTimeout(()=> el.remove(), 320);
  }, ms || 3800);
}
function notify(type, title, body, opts){
  opts = opts || {};
  if(userData){
    userData.notifications.unshift(makeNote(type, title, body));
    if(userData.notifications.length > 40) userData.notifications.length = 40;
    saveUser();
    updateNotifBadge();
  }
  if(!opts.silent) toast(type, title, body, opts.ms);
}
function unreadCount(){
  return userData ? userData.notifications.filter(n=>!n.read).length : 0;
}
function updateNotifBadge(){
  const btn = document.getElementById('hub-notif-btn');
  if(!btn) return;
  const n = unreadCount();
  btn.innerHTML = '🔔 Dispatch' + (n ? '<span class="notif-dot">' + (n > 9 ? '9+' : n) + '</span>' : '');
}
function timeAgo(ts){
  const s = Math.floor((Date.now() - ts)/1000);
  if(s < 60) return 'just now';
  if(s < 3600) return Math.floor(s/60) + ' min ago';
  if(s < 86400) return Math.floor(s/3600) + ' hr ago';
  return new Date(ts).toLocaleDateString();
}
function renderNotifications(){
  const list = document.getElementById('notif-list');
  list.innerHTML = '';
  const notes = userData ? userData.notifications : [];
  if(!notes.length){
    list.innerHTML = '<div id="notif-empty">Nothing logged yet. Clear a shift and it will show up here.</div>';
    return;
  }
  notes.forEach(n=>{
    const row = document.createElement('div');
    row.className = 'notif-item' + (n.read ? '' : ' unread');
    row.innerHTML = '<div class="n-icon">' + withGems(TOAST_ICONS[n.type] || 'ℹ️') + '</div>' +
      '<div><b>' + withGems(esc(n.title)) + '</b><span>' + withGems(esc(n.body || '')) + '</span>' +
      '<time>' + timeAgo(n.ts) + '</time></div>';
    list.appendChild(row);
  });
}
function openNotifications(){
  renderNotifications();
  document.getElementById('notif-overlay').classList.remove('hidden');
  if(userData){
    userData.notifications.forEach(n=> n.read = true);
    saveUser();
    updateNotifBadge();
  }
}

// ======================================================
// REWARDS
// ======================================================
function coinsBalance(){ return userData ? userData.rewards.coins : 0; }
function addCoins(n){
  if(!userData || n <= 0) return 0;
  n = Math.round(n);
  userData.rewards.coins += n;
  userData.rewards.lifetime += n;
  saveUser();
  updateCoinDisplays();
  return n;
}
function spendCoins(n){
  if(!userData || userData.rewards.coins < n) return false;
  userData.rewards.coins -= n;
  userData.rewards.spent += n;
  saveUser();
  updateCoinDisplays();
  return true;
}
function updateCoinDisplays(){
  const c = coinsBalance();
  const hub = document.getElementById('hub-coin-label');
  if(hub) hub.innerHTML = gem(c);
  const shop = document.getElementById('shop-coin-label');
  if(shop) shop.innerHTML = gem(c);
}
function hasItem(id){ return !!(userData && userData.inventory.owned.indexOf(id) !== -1); }

// ======================================================
// AUTH
// ======================================================
const authOverlay = document.getElementById('auth-overlay');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const currentUserLabel = document.getElementById('current-user-label');

// The in-game HUD (title/meter card, objective banner, controls hint,
// touch-pad) is fixed-position and was never being hidden away from a
// level — so it kept floating on top of (and the still-rendering 3D scene
// kept showing through behind) the lobby, sign-in and customize screens.
// This toggles all of it off whenever we're not actually inside a level.
function setGameChromeVisible(visible){
  ['hud','Mission-banner','controls-hint','touch-pad'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = visible ? '' : 'none';
  });
}

// ======================================================
// WORLDS MENU: jump straight to any unlocked world (separate from the Map)
// ======================================================
function closeWorldPicker(){
  const old = document.getElementById('world-picker');
  if(old) old.remove();
  if(!hubOpen) pauseOpen = false;
}
function openWorldPicker(){
  closeWorldPicker();
  pauseOpen = true; // the game is frozen while the player chooses
  const ov = document.createElement('div');
  ov.id = 'world-picker'; ov.className = 'wp-overlay';
  ov.innerHTML = '<div class="wp-card"><h3>🌍 Worlds</h3>' +
    '<p>Pumili kung saang world ka pupunta. Naka-lock pa ang hindi pa na-u-unlock.</p>' +
    '<div class="wp-list"></div><button type="button" class="wp-close">Close</button></div>';
  const list = ov.querySelector('.wp-list');
  LEVELS.forEach((l,i)=>{
    const locked = !isLevelUnlocked(i);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'wp-item'; b.disabled = locked;
    const note = locked ? '🔒 Locked — clear the previous posting first'
               : (i === currentLevelIndex ? 'You are here' : l.subtitle);
    b.innerHTML = '<span class="wp-ico">' + l.icon + '</span><span><b>' + esc(l.title) + '</b><small>' + esc(note) + '</small></span>';
    b.onclick = ()=>{ ov.remove(); openDifficultyPicker(i); };
    list.appendChild(b);
  });
  ov.querySelector('.wp-close').onclick = closeWorldPicker;
  ov.addEventListener('mousedown', e=>{ if(e.target === ov) closeWorldPicker(); });
  document.body.appendChild(ov);
}
document.getElementById('worlds-btn').onclick = ()=>{
  if(hubOpen || dialogueOpen || pauseOpen || customizeOpen || !player) return;
  if(document.getElementById('complete-overlay').classList.contains('show')) return;
  openWorldPicker();
};

function showAuthScreen(){
  currentUser = null;
  userData = null;
  DB.logout();                 // writes the last save online, then signs out (does nothing in local mode)
  setAuthBusy(false);
  closeWorldPicker();
  authOverlay.classList.remove('hidden');
  hubOverlay.classList.add('hidden');
  document.getElementById('customize-overlay').classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  localMapOverlay.classList.add('hidden');
  authError.textContent = '';
  authPassword.value = '';
  document.body.className = 'hub-theme';
  setGameChromeVisible(false);
}

// ---- sign-in screen helpers
function showAuthMsg(text, isInfo){
  authError.textContent = text || '';
  authError.classList.toggle('info', !!isInfo);
}
function setAuthBusy(busy){
  document.getElementById('login-btn').disabled = busy;
  document.getElementById('register-btn').disabled = busy;
}
function refreshAuthNote(){
  document.getElementById('auth-note').textContent = DB.describeBackend();
  document.getElementById('auth-sub').textContent = DB.mode === 'firebase'
    ? 'Sign in to continue your progress, or create a new account.'
    : 'Sign in to save your progress on this device, or create a new account.';
}

async function startSession(username, isNew){
  let u;
  try{ u = await DB.recordLogin(username); }
  catch(err){
    setAuthBusy(false);
    showAuthMsg((err && err.friendly) || 'Could not load your save. Check your connection and try again.');
    DB.logout();
    return;
  }
  setAuthBusy(false);

  currentUser = username;
  userData = u;
  currentCharacter = Object.assign({}, DEFAULT_CHARACTER, u.character || {});
  audioEnabled = u.settings.audio !== false;
  document.getElementById('audio-btn').textContent = audioEnabled ? '🔊' : '🔇';
  authOverlay.classList.add('hidden');
  currentUserLabel.textContent = 'Signed in as ' + username;
  updateCoinDisplays();
  updateNotifBadge();

  showLoading(
    isNew ? 'Creating your account' : 'Signing you in',
    isNew ? 'Setting up progress, rewards and dispatch log' : 'Restoring progress and rewards',
    isNew ? 1500 : 1100,
    ()=>{
      if(isNew){
        notify('success','Account created', 'Welcome aboard, ' + username + '. Your progress and credits now save ' + (DB.mode === 'firebase' ? 'online to your account.' : 'to this browser.'));
      } else {
        const cleared = LEVELS.filter((l,i)=> isLevelCleared(i)).length;
        notify('success','Signed in', 'Welcome back, ' + username + '. ' + cleared + ' of ' + LEVELS.length +
          ' postings cleared, ◈' + coinsBalance() + ' in credits.');
      }
      if(u.character) { showHub(); }
      else { showCustomizeScreen({fromPause:false}); }
    }
  );
}

document.getElementById('login-btn').onclick = async ()=>{
  const u = authUsername.value.trim();
  const p = authPassword.value;
  if(!u || !p){ showAuthMsg('Enter a username and password.'); return; }
  setAuthBusy(true);
  showAuthMsg(DB.mode === 'firebase' ? 'Signing in…' : '', true);
  const result = await DB.verifyLogin(u, p);
  if(!result.ok){ setAuthBusy(false); showAuthMsg(result.error); return; }
  showAuthMsg('');
  startSession(u, false);
};

document.getElementById('register-btn').onclick = async ()=>{
  const u = authUsername.value.trim();
  const p = authPassword.value;
  if(!u || !p){ showAuthMsg('Choose a username and password.'); return; }
  const problem = DB.checkCredentials(u, p);
  if(problem){ showAuthMsg(problem); return; }
  setAuthBusy(true);
  showAuthMsg(DB.mode === 'firebase' ? 'Creating your account…' : '', true);
  const result = await DB.register(u, p);
  if(!result.ok){ setAuthBusy(false); showAuthMsg(result.error); return; }
  showAuthMsg('');
  startSession(u, true);
};

document.getElementById('logout-btn').onclick = ()=>{
  if(userData) saveUser();
  showAuthScreen();
};

[authUsername, authPassword].forEach(el=>{
  el.addEventListener('keydown', e=>{ if(e.key === 'Enter') document.getElementById('login-btn').click(); });
});

// ======================================================
// DIFFICULTY
// Every posting can be run on three shifts. Lighting is the main
// lever: Day shift is lit normally, Night shift kills the ambient
// light and leaves you a torch, Blackout narrows the beam further
// and puts a clock on the run.
// ======================================================
// Every shift has a clock and 3 lives. When the clock runs out you lose a life
// and the clock restarts. No lives left = Game Over.
const DIFFICULTIES = {
  easy:{
    id:'easy', name:'Day shift', short:'Day', emoji:'🌤',
    desc:'Normal lighting and a generous clock. 3 lives: a wrong answer or a timed-out clock each costs one.',
    hemi:0.9, sun:1.1, ambient:0.28, shadows:true, fogMul:1, dark:false, bodyClass:'',
    playerLight:0.5, playerLightDist:6, flashlight:0, flashAngle:0.4, flashDist:24,
    timeLimit:240, wrongPenalty:0, coinMult:1
  },
  medium:{
    id:'medium', name:'Night shift', short:'Night', emoji:'🌘',
    desc:'Lights out. You carry a torch, the clock is tighter, and a wrong answer or a timed-out clock costs a life.',
    hemi:0.16, sun:0.14, ambient:0.05, shadows:true, fogMul:2.6, dark:true, bodyClass:'dim',
    playerLight:0.5, playerLightDist:7, flashlight:1.7, flashAngle:0.45, flashDist:28,
    timeLimit:200, wrongPenalty:0, coinMult:1.6
  },
  hard:{
    id:'hard', name:'Blackout', short:'Blackout', emoji:'🌑',
    desc:'Near-total darkness and a narrow beam. A wrong call costs a life and burns shift time.',
    hemi:0.06, sun:0.05, ambient:0.02, shadows:false, fogMul:4.2, dark:true, bodyClass:'blackout',
    playerLight:0.35, playerLightDist:5, flashlight:2.1, flashAngle:0.3, flashDist:23,
    timeLimit:210, wrongPenalty:15, coinMult:2.5
  }
};
let currentDifficulty = DIFFICULTIES.easy;
let pendingLevelIndex = -1;

function starString(n){ return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3-n); }

function openDifficultyPicker(idx){
  pendingLevelIndex = idx;
  const lvl = LEVELS[idx];
  document.getElementById('diff-title').textContent = lvl.icon + ' ' + lvl.title;
  document.getElementById('diff-sub').textContent = lvl.objective + '. Harder shifts pay more credits.';
  const list = document.getElementById('diff-list');
  list.innerHTML = '';
  DIFF_IDS.forEach(id=>{
    const d = DIFFICULTIES[id];
    const rec = stageRecord(lvl.id, id);
    const btn = document.createElement('button');
    btn.className = 'diff-card';
    btn.innerHTML =
      '<span class="d-emoji">' + d.emoji + '</span>' +
      '<span><span class="d-name">' + d.name + '</span>' +
      '<span class="d-desc">' + esc(d.desc) + '</span></span>' +
      '<span class="d-meta">' + gem('×' + d.coinMult) + '<em>' + (rec.cleared ? starString(rec.bestStars) + ' cleared' : 'not cleared') + '</em></span>';
    btn.onclick = ()=>{
      document.getElementById('difficulty-overlay').classList.add('hidden');
      startLevel(idx, id);
    };
    list.appendChild(btn);
  });
  document.getElementById('difficulty-overlay').classList.remove('hidden');
}
document.getElementById('diff-cancel').onclick = ()=>{
  document.getElementById('difficulty-overlay').classList.add('hidden');
  if(!hubOpen) pauseOpen = false; // un-freeze the game if we came from the Worlds menu
};

function startLevel(idx, diffId){
  const lvl = LEVELS[idx];
  const d = DIFFICULTIES[diffId];
  hubOverlay.classList.add('hidden');
  showLoading(lvl.icon + ' ' + lvl.title, d.emoji + ' ' + d.name + ' — building the scene', 1250, ()=>{
    loadLevel(idx, diffId);
  });
}

// ======================================================
// SHOP
// Gear changes how a shift plays; looks are purely cosmetic.
// ======================================================
const SHOP_ITEMS = [
  { id:'gear-lumen', cat:'Gear', icon:'🔦', name:'Lumen core', cost:600,
    desc:'A wider, brighter torch on Night shift and Blackout runs.' },
  { id:'gear-timebank', cat:'Gear', icon:'⏱', name:'Extra hour', cost:520,
    desc:'Adds 45 seconds to the shift clock on every Blackout run.' },
  { id:'gear-notes', cat:'Gear', icon:'📓', name:'Analyst notes', cost:450,
    desc:'Names the technique being used before you choose your answer.' },
  { id:'gear-scanner', cat:'Gear', icon:'📡', name:'Pocket scanner', cost:380,
    desc:'Evidence chips glow much further, so dark maps are easier to sweep.' },
  { id:'gear-stipend', cat:'Gear', icon:'💠', name:'Sentinel stipend', cost:900,
    desc:'Every shift pays 25% more credits from here on.' },
  { id:'look-obsidian', cat:'Looks', icon:'🧥', name:'Obsidian kit', cost:280, slot:'outfit', color:0x23263A,
    desc:'Matte black field jacket. Suits the darker postings.' },
  { id:'look-tidewatch', cat:'Looks', icon:'🧥', name:'Tidewatch kit', cost:280, slot:'outfit', color:0x7FE3C4,
    desc:'Pale seafoam, issued to the shoreline patrol.' },
  { id:'look-ultraviolet', cat:'Looks', icon:'🧥', name:'Ultraviolet kit', cost:460, slot:'outfit', color:0x6A3DE8,
    desc:'Void-spec weave that catches the lattice light.' },
  { id:'badge-quantum', cat:'Looks', icon:'🪪', name:'Quantum badge', cost:340, slot:'badge', color:0xC9B8FF,
    desc:'A badge that glows faint violet in the dark.' },
  { id:'badge-ember', cat:'Looks', icon:'🪪', name:'Ember badge', cost:340, slot:'badge', color:0xFF8A3D,
    desc:'Warm amber badge light for night work.' }
];

function buyItem(item){
  if(hasItem(item.id)) return;
  if(!spendCoins(item.cost)){
    toast('warn','Not enough credits','You need ◈' + (item.cost - coinsBalance()) + ' more. Clear a harder shift to earn faster.');
    return;
  }
  userData.inventory.owned.push(item.id);
  saveUser();
  notify('shop','Purchased ' + item.name, 'Spent ◈' + item.cost + '. Balance is now ◈' + coinsBalance() + '.');
  if(item.slot) equipItem(item, true);
  renderShop();
  if(player && !hubOpen) applyDifficultyLighting();
}
function equipItem(item, silent){
  const slot = item.slot;
  if(!slot) return;
  const already = userData.inventory.equipped[slot] === item.id;
  userData.inventory.equipped[slot] = already ? null : item.id;
  const active = !already;
  if(slot === 'outfit') currentCharacter.shirt = active ? item.color : DEFAULT_CHARACTER.shirt;
  if(slot === 'badge') currentCharacter.badge = active ? item.color : DEFAULT_CHARACTER.badge;
  userData.character = currentCharacter;
  saveUser();
  if(player && !hubOpen){
    const pos = player.position.clone(), rotY = player.rotation.y;
    buildPlayer();
    player.position.copy(pos); player.rotation.y = rotY; player.userData.baseRotY = rotY;
  }
  if(!silent) renderShop();
}
function renderShop(){
  const body = document.getElementById('shop-body');
  body.innerHTML = '';
  ['Gear','Looks'].forEach(cat=>{
    const head = document.createElement('div');
    head.className = 'shop-section';
    head.textContent = cat === 'Gear' ? 'Gear that changes the run' : 'Looks for your sentinel';
    body.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    SHOP_ITEMS.filter(i=>i.cat === cat).forEach(item=>{
      const owned = hasItem(item.id);
      const equipped = item.slot && userData.inventory.equipped[item.slot] === item.id;
      const card = document.createElement('div');
      card.className = 'shop-item' + (owned ? ' owned' : '');
      const swatch = item.color ? '<span class="shop-swatch" style="background:#' + item.color.toString(16).padStart(6,'0') + '"></span>' : '';
      card.innerHTML =
        '<div class="s-top"><span class="s-icon">' + item.icon + '</span><h4>' + esc(item.name) + '</h4>' + swatch + '</div>' +
        '<p>' + esc(item.desc) + '</p>';
      const btn = document.createElement('button');
      if(!owned){
        btn.innerHTML = 'Buy for ' + gem(item.cost);
        btn.disabled = coinsBalance() < item.cost;
        btn.onclick = ()=> buyItem(item);
      } else if(item.slot){
        btn.textContent = equipped ? 'Worn — tap to remove' : 'Wear this';
        btn.className = equipped ? 'equipped' : 'equip';
        btn.onclick = ()=> equipItem(item);
      } else {
        btn.textContent = 'In your kit';
        btn.className = 'held';
      }
      card.appendChild(btn);
      grid.appendChild(card);
    });
    body.appendChild(grid);
  });
}
function openShop(){
  if(!userData) return;
  updateCoinDisplays();
  renderShop();
  document.getElementById('shop-overlay').classList.remove('hidden');
}
document.getElementById('shop-close').onclick = ()=> document.getElementById('shop-overlay').classList.add('hidden');
document.getElementById('notif-close').onclick = ()=> document.getElementById('notif-overlay').classList.add('hidden');

// Shop, difficulty picker and dispatch log are lightweight modals that can
// float over the hub, the pause menu, or each other — Escape and a click on
// the dimmed backdrop should always dismiss whichever one is on top.
const QUICK_MODAL_IDS = ['shop-overlay','difficulty-overlay','notif-overlay','exit-confirm-overlay'];
function openQuickModalId(){
  return QUICK_MODAL_IDS.find(id => !document.getElementById(id).classList.contains('hidden')) || null;
}
function closeQuickModal(id){
  document.getElementById(id).classList.add('hidden');
  // closing the difficulty picker mid-level must not leave the game frozen
  if(id === 'difficulty-overlay' && !hubOpen) pauseOpen = false;
}
QUICK_MODAL_IDS.forEach(id=>{
  document.getElementById(id).addEventListener('mousedown', e=>{
    if(e.target.id === id) closeQuickModal(id);
  });
});
let currentLevelIndex = -1;
let currentLevel = null;
let currentBuoys = [];
let completedIds = new Set();
let levelTrustScore = 0;
let hubOpen = true;
let dialogueOpen = false;
let pauseOpen = false;
let BOUNDS = {x:40, zMin:-40, zMax:30};
let particles = [];
let currentStuds = [];
let studsCollected = 0;
let totalStuds = 0;
let flashTimer = 0;

// ======================================================
// TINY SYNTH AUDIO — no external assets, just oscillators
// ======================================================
let audioCtx = null;
let audioEnabled = true;
function ensureAudio(){
  if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
  if(audioCtx && audioCtx.state === 'suspended'){ audioCtx.resume(); }
}
function tone(freq, dur, type, vol, delay){
  if(!audioEnabled) return;
  ensureAudio(); if(!audioCtx) return;
  const t0 = audioCtx.currentTime + (delay||0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol||0.18, t0+0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0+dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0+dur+0.05);
}
function playCorrectSound(){ tone(523.25,0.15,'triangle',0.16,0); tone(659.25,0.15,'triangle',0.16,0.09); tone(783.99,0.24,'triangle',0.18,0.18); }
function playIncorrectSound(){ tone(220,0.18,'sawtooth',0.13,0); tone(164.81,0.28,'sawtooth',0.14,0.1); }
function playNoticeSound(){ tone(660,0.09,'sine',0.08,0); tone(880,0.07,'sine',0.06,0.05); }
function playJumpSound(){
  if(!audioEnabled) return; ensureAudio(); if(!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type='sine'; osc.frequency.setValueAtTime(300,t0); osc.frequency.exponentialRampToValueAtTime(680,t0+0.15);
  gain.gain.setValueAtTime(0.13,t0); gain.gain.exponentialRampToValueAtTime(0.001,t0+0.18);
  osc.connect(gain).connect(audioCtx.destination); osc.start(t0); osc.stop(t0+0.2);
}
function playLandSound(){ tone(120,0.1,'sine',0.1,0); }
function playStepSound(){ tone(90+Math.random()*20,0.06,'square',0.04,0); }
function playCollectSound(){ tone(880,0.09,'sine',0.14,0); tone(1174.66,0.13,'sine',0.15,0.06); }
function playFanfare(){ [523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,0.26,'triangle',0.2,i*0.12)); }

// screen flash (green on correct, red on incorrect)
const flashEl = document.getElementById('flash');
function screenFlash(color){
  flashEl.style.transition = 'none';
  flashEl.style.background = `radial-gradient(circle, ${color}, transparent 70%)`;
  flashEl.style.opacity = '1';
  void flashEl.offsetWidth;
  flashEl.style.transition = 'opacity .5s ease';
  flashEl.style.opacity = '0';
}

// confetti / stud-burst particles
function spawnBurst(pos, colors, count){
  for(let i=0;i<count;i++){
    const c = colors[Math.floor(Math.random()*colors.length)];
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.14,0.14), new THREE.MeshStandardMaterial({color:c, emissive:c, emissiveIntensity:0.4, transparent:true}));
    m.position.copy(pos);
    m.position.x += (Math.random()-0.5)*0.4; m.position.z += (Math.random()-0.5)*0.4;
    const ang = Math.random()*Math.PI*2, spd = 2+Math.random()*3.5;
    m.userData.vel = new THREE.Vector3(Math.cos(ang)*spd, 4.5+Math.random()*3, Math.sin(ang)*spd);
    m.userData.life = 1.0 + Math.random()*0.5;
    scene.add(m);
    particles.push(m);
  }
}
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.userData.vel.y -= 9.8*dt;
    p.position.addScaledVector(p.userData.vel, dt);
    p.rotation.x += dt*6; p.rotation.y += dt*5;
    p.userData.life -= dt;
    p.material.opacity = Math.max(0, Math.min(1, p.userData.life));
    if(p.userData.life <= 0 || p.position.y < -3){
      scene.remove(p); p.geometry.dispose(); p.material.dispose();
      particles.splice(i,1);
    }
  }
}

// ======================================================
// THREE.JS CORE
// ======================================================
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 500);

function resize(){
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let hemi, sunLight, fillLight;
function setupLights(){
  hemi = new THREE.HemisphereLight(0xFFE1A8, 0xD9BD82, 0.9); scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xFFE8C0, 1.1);
  sunLight.position.set(-30,45,-20); sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024,1024);
  sunLight.shadow.camera.left=-60; sunLight.shadow.camera.right=60;
  sunLight.shadow.camera.top=60; sunLight.shadow.camera.bottom=-60; sunLight.shadow.camera.far=150;
  scene.add(sunLight);
  fillLight = new THREE.AmbientLight(0xFFFFFF, 0.28); scene.add(fillLight);
}

function clearScene(){
  // dispose geometry, materials and textures so repeated restarts do not slow the game down
  scene.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
  });
  while(scene.children.length){ scene.remove(scene.children[0]); }
}

// ======================================================
// LEGO-STYLE BLOCKY MINIFIGURES (shared builder)
// ======================================================
function makeLegoFigure(torsoColor, pantsColor, skinColor, faceShape, hairStyle, hairColor){
  const g = new THREE.Group();
  const SKIN = skinColor || 0xFFCB4C; // classic minifig plastic yellow, or player-chosen tone
  const matSkin = new THREE.MeshStandardMaterial({color:SKIN, roughness:0.35, metalness:0.05});
  const matTorso = new THREE.MeshStandardMaterial({color:torsoColor, roughness:0.4, metalness:0.05});
  const matPants = new THREE.MeshStandardMaterial({color:pantsColor, roughness:0.45, metalness:0.05});
  const matEyes = new THREE.MeshStandardMaterial({color:0x1B2A3A});

  // legs — two blocky boxes
  const legGeo = new THREE.BoxGeometry(0.34,0.75,0.4);
  const legL = new THREE.Mesh(legGeo, matPants); legL.position.set(-0.19,0.375,0); legL.castShadow=true; g.add(legL);
  const legR = new THREE.Mesh(legGeo, matPants); legR.position.set(0.19,0.375,0); legR.castShadow=true; g.add(legR);
  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.76,0.18,0.42), matPants);
  hip.position.set(0,0.75,0); hip.castShadow = true; g.add(hip);

  // torso — slightly tapered stacked boxes for that brick silhouette
  const torsoLower = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.55,0.4), matTorso);
  torsoLower.position.set(0,1.13,0); torsoLower.castShadow = true; g.add(torsoLower);
  const torsoUpper = new THREE.Mesh(new THREE.BoxGeometry(0.84,0.16,0.42), matTorso);
  torsoUpper.position.set(0,1.45,0); torsoUpper.castShadow = true; g.add(torsoUpper);

  // arms — cylinder + blocky C-hand, angled slightly outward
  const armGeo = new THREE.CylinderGeometry(0.11,0.11,0.6,8);
  const handGeo = new THREE.BoxGeometry(0.17,0.2,0.17);
  const arms = [];
  [-1,1].forEach(side=>{
    const armGroup = new THREE.Group();
    const arm = new THREE.Mesh(armGeo, matTorso);
    arm.position.y = -0.3; arm.castShadow = true; armGroup.add(arm);
    const hand = new THREE.Mesh(handGeo, matSkin);
    hand.position.y = -0.7; hand.castShadow = true; armGroup.add(hand);
    armGroup.position.set(side*0.47, 1.42, 0);
    armGroup.rotation.z = side*0.14;
    armGroup.userData.restZ = side*0.14;
    g.add(armGroup);
    arms.push(armGroup);
  });

  // neck + head — shape depends on the chosen face shape (round/square/long)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.1,10), matSkin);
  neck.position.set(0,1.58,0); g.add(neck);

  let headGeo, headY = 1.9, studY = 2.16;
  if(faceShape === 'square'){
    headGeo = new THREE.BoxGeometry(0.62,0.5,0.6);
  } else if(faceShape === 'long'){
    headGeo = new THREE.CylinderGeometry(0.30,0.30,0.58,18);
    headY = 1.96; studY = 2.28;
  } else { // 'round' (default)
    headGeo = new THREE.CylinderGeometry(0.34,0.34,0.44,18);
  }
  const head = new THREE.Mesh(headGeo, matSkin);
  head.position.set(0,headY,0); head.castShadow = true; g.add(head);
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.09,12), matSkin);
  stud.position.set(0,studY,0);
  const hasHair = hairStyle && hairStyle !== 'none';
  if(!hasHair) g.add(stud); // classic minifig stud, hidden once a hairpiece is worn

  if(hasHair){
    const matHair = new THREE.MeshStandardMaterial({color: hairColor || 0x2B1B12, roughness:0.55});
    if(hairStyle === 'short'){
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36,14,10,0,Math.PI*2,0,Math.PI/1.85), matHair);
      cap.position.set(0, headY+0.12, 0); cap.castShadow = true; g.add(cap);
    } else if(hairStyle === 'long'){
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36,14,10,0,Math.PI*2,0,Math.PI/1.85), matHair);
      cap.position.set(0, headY+0.12, 0); cap.castShadow = true; g.add(cap);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.16), matHair);
      back.position.set(0, headY-0.08, -0.27); back.castShadow = true; g.add(back);
    } else if(hairStyle === 'mohawk'){
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.11,0.24,0.48), matHair);
      ridge.position.set(0, headY+0.3, 0); ridge.castShadow = true; g.add(ridge);
    }
  }

  // simple printed face
  const faceZ = faceShape === 'square' ? 0.31 : 0.32;
  const eyeY = faceShape === 'long' ? headY+0.04 : 1.94;
  const mouthY = faceShape === 'long' ? headY-0.14 : 1.8;
  [-0.11,0.11].forEach(ex=>{
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035,8,8), matEyes);
    eye.position.set(ex,eyeY,faceZ); g.add(eye);
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.03,0.02), matEyes);
  mouth.position.set(0,mouthY,faceZ+0.01); g.add(mouth);

  g.userData.legL = legL; g.userData.legR = legR;
  g.userData.armL = arms[0]; g.userData.armR = arms[1];
  g.userData.head = head; g.userData.headStud = stud;
  g.userData.phase = Math.random()*Math.PI*2;
  g.userData.walkAmt = 0;
  return g;
}

// drives a walk-cycle (0..1 amt) or gentle idle sway on any lego figure
function animateFigure(g, dt, walking, t, phaseOffset){
  const u = g.userData;
  u.phase += dt * (walking ? 8 : 1.4);
  const target = walking ? 1 : 0;
  u.walkAmt = THREE.MathUtils.lerp(u.walkAmt, target, Math.min(1, dt*8));
  const swing = Math.sin(u.phase) * 0.6 * u.walkAmt;
  u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing*0.85; u.armR.rotation.x = swing*0.85;
  if(u.walkAmt < 0.05){
    const idle = Math.sin((t||0)*0.9 + (phaseOffset||0));
    g.rotation.y = (g.userData.baseRotY||0) + idle*0.1;
    u.head.rotation.z = idle*0.06;
    u.armL.rotation.z = u.armL.userData.restZ + idle*0.04;
    u.armR.rotation.z = u.armR.userData.restZ - idle*0.04;
  } else {
    u.head.rotation.z = Math.sin(u.phase*0.5)*0.04;
  }
}

// player
let player, playerLight;
let playerVelY = 0, playerGrounded = true, playerY = 0;
const GRAVITY = -20, JUMP_SPEED = 7.2;
function buildPlayer(){
  if(player){ scene.remove(player); }
  player = makeLegoFigure(currentCharacter.shirt, currentCharacter.pants, currentCharacter.skin, currentCharacter.face, currentCharacter.hair, currentCharacter.hairColor); // player's chosen sentinel look
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.22,0.03), new THREE.MeshStandardMaterial({color:currentCharacter.badge, emissive:currentCharacter.badge, emissiveIntensity:0.4}));
  badge.position.set(0.2,1.32,0.21); player.add(badge);
  scene.add(player);
  playerLight = new THREE.PointLight(0xFFF3D6, 0.5, 6);
  playerLight.position.set(0,2,0); player.add(playerLight);

  // torch used on the darker shifts — a child of the player, so it
  // always points wherever the sentinel is facing
  playerSpot = new THREE.SpotLight(0xFFF6DC, 0, 26, 0.4, 0.5, 1.1);
  playerSpot.position.set(0,2.5,0);
  playerSpotTarget = new THREE.Object3D();
  playerSpotTarget.position.set(0,0.6,8);
  player.add(playerSpot); player.add(playerSpotTarget);
  playerSpot.target = playerSpotTarget;

  playerVelY = 0; playerGrounded = true; playerY = 0;
  applyDifficultyLighting();
}
function requestJump(){
  if(hubOpen || dialogueOpen || pauseOpen || customizeOpen || !player) return;
  if(!playerGrounded) return;
  playerVelY = JUMP_SPEED; playerGrounded = false;
  playJumpSound();
}

// ======================================================
// BYSTANDER WALKING (waypoint navigation for background people)
// ======================================================
// ======================================================
// TALKING: "..." THEN SCRAMBLED LETTERS, THEN THE REAL LINE
// and characters turning to face whoever they are talking to
// ======================================================
let typingTimer = null, typingFinish = null;
function typeInto(el, text, done){
  clearInterval(typingTimer);
  const junk = 'abcdefghijklmnopqrstuvwxyz?!#%';
  let n = 0;
  const finish = ()=>{
    clearInterval(typingTimer); typingTimer = null; typingFinish = null;
    el.textContent = text;
    if(done) done();
  };
  typingFinish = finish;
  el.textContent = '.';                                          // the dots start straight away
  typingTimer = setInterval(()=>{
    n++;
    if(n <= 6){
      el.textContent = '.'.repeat(n % 3 + 1);                    // "..." like they are thinking
    } else if(n <= 15){
      const reveal = Math.floor((n-6)/9 * text.length);           // scrambled letters slowly clearing up
      el.textContent = text.split('').map((ch,i)=>
        (i < reveal || ch === ' ') ? ch : junk[Math.floor(Math.random()*junk.length)]).join('');
    } else {
      finish();
    }
  }, 85);
}
function skipTyping(){ if(typingFinish) typingFinish(); }   // click / Enter / Space shows the line at once

function faceTowardPlayer(g, dt){
  if(!player) return;
  const target = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z);
  const diff = Math.atan2(Math.sin(target - g.rotation.y), Math.cos(target - g.rotation.y));
  g.rotation.y += diff * Math.min(1, dt*8);
  g.userData.baseRotY = g.rotation.y;
}

// ======================================================
// BYSTANDER WALKING (waypoint navigation for background people)
// ======================================================
function updateBystanderWalk(b, dt, t){
  if(b.talkingToPlayer && player){
    faceTowardPlayer(b.group, dt);            // turn to whoever is asking them something
    animateFigure(b.group, dt, false, t, b.phase);
    return;
  }
  if(b.chatting){
    animateFigure(b.group, dt, false, t, b.phase);   // paused mid-conversation with a neighbour
    return;
  }
  if(!b.patrol){
    b.group.rotation.y = b.group.userData.baseRotY + Math.sin(t*0.5 + b.phase)*0.08;
    return;
  }
  const target = b.patrol[b.patrolIndex];
  const dx = target.x - b.group.position.x;
  const dz = target.z - b.group.position.z;
  const dist = Math.hypot(dx, dz);
  if(dist < 0.25){
    b.patrolIndex = (b.patrolIndex + 1) % b.patrol.length;
    return;
  }
  const mx = dx/dist, mz = dz/dist;
  b.group.position.x += mx * b.patrolSpeed * dt;
  b.group.position.z += mz * b.patrolSpeed * dt;
  const targetRot = Math.atan2(mx, mz);
  let diff = targetRot - b.group.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  b.group.rotation.y += diff * Math.min(1, dt*6);
  animateFigure(b.group, dt, true, t, b.phase);
}

const BYSTANDER_HINTS = [
  (q,job) => `"${job==='dog walker'?"Walked past here twice already":"Been standing around here a while"} — noticed something a little off near ${q}."`,
  (q,job) => `"You looking for trouble? Try around ${q} — someone's been acting strange there."`,
  (q,job) => `"Not my business, but ${q} seemed off earlier. Just saying."`,
  (q,job) => `"As a ${job}, I'm out here a lot — ${q} has felt a bit weird lately."`,
  (q,job) => `"Word around here: keep an eye on ${q}."`,
  (q,job) => `"Funny you're out looking — I clocked something odd near ${q} not long ago."`,
  (q,job) => `"Between you and me? ${q} gave me a weird feeling earlier."`,
  (q,job) => `"You a ${job} too? Anyway — heads up on ${q}, something felt off."`,
  (q,job) => `"I don't usually pay attention, but ${q} made me look twice."`,
  (q,job) => `"Ask around near ${q} — a few of us noticed the same thing."`,
  (q,job) => `"Take it from a ${job} — ${q} has been acting up all day."`,
  (q,job) => `"Might be nothing, but ${q} rubbed me the wrong way."`,
  (q,job) => `"Alam mo, medyo kakaiba yung ${q} — sulit tignan."`,
  (q,job) => `"'Yan nga pala, may napansin ako sa ${q} kanina."`
];
const BYSTANDER_BUMP_RADIUS = 1.4; // close enough to actually talk
let bystanderChatOpen = false;
let bystanderTalker = null;

function openBystanderChat(line, job, who){
  if(dialogueOpen) return; // don't interrupt a real quest conversation
  bystanderChatOpen = true;
  dialogueOpen = true;
  bystanderTalker = who || null;
  if(who) who.talkingToPlayer = true;
  wrap.classList.remove('hidden'); wrap.classList.add('show');
  feedbackWrap.classList.remove('show');
  choicesEl.innerHTML = ''; choicesEl.style.display = 'none';
  npcNameEl.textContent = job ? ('Passerby · ' + job.charAt(0).toUpperCase()+job.slice(1)) : 'Passerby';
  document.getElementById('dialogue-hint').style.display = 'none';
  typeInto(scenarioEl, line, ()=>{
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = 'Alright, thanks.';
    btn.onclick = closeBystanderChat;
    choicesEl.appendChild(btn);
    choicesEl.style.display = 'flex';
    speakLine(line);
  });
}
function closeBystanderChat(){
  clearInterval(typingTimer); typingFinish = null;
  if(bystanderTalker){ bystanderTalker.talkingToPlayer = false; bystanderTalker = null; }
  wrap.classList.remove('show'); wrap.classList.add('hidden');
  dialogueOpen = false; bystanderChatOpen = false;
  if('speechSynthesis' in window) speechSynthesis.cancel();
}

// literally "voices" a line using the browser's built-in text-to-speech,
// so passersby actually talk instead of just showing text
function speakLine(line){
  if(!audioEnabled || !('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel(); // don't stack overlapping lines
    const clean = line.replace(/["“”]/g, '');
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.02; utter.pitch = 1.05; utter.volume = 0.85;
    speechSynthesis.speak(utter);
  }catch(e){ /* speech synthesis unsupported or blocked — fail silently */ }
}

function updateBystanderHints(){
  if(!player || !currentLevel || !currentLevel._env || !currentLevel._env.bystanders) return;
  if(dialogueOpen && !bystanderChatOpen) return; // player's mid-quest-conversation, leave them be

  // find the nearest not-yet-completed quest, to point the hint toward
  let nearestQuest = null, nearestDist = Infinity;
  currentBuoys.forEach(b=>{
    if(completedIds.has(b.quest.id)) return;
    const d = Math.hypot(b.group.position.x-player.position.x, b.group.position.z-player.position.z);
    if(d < nearestDist){ nearestDist = d; nearestQuest = b.quest; }
  });

  currentLevel._env.bystanders.forEach(b=>{
    const d = Math.hypot(b.group.position.x-player.position.x, b.group.position.z-player.position.z);
    const bumping = d < BYSTANDER_BUMP_RADIUS;
    if(bumping && !b.hinted && !dialogueOpen && !b.chatting){
      b.hinted = true;
      let hintIdx = Math.floor(Math.random()*BYSTANDER_HINTS.length);
      if(BYSTANDER_HINTS.length>1 && b.lastHintIdx===hintIdx){
        hintIdx = (hintIdx+1+Math.floor(Math.random()*(BYSTANDER_HINTS.length-1))) % BYSTANDER_HINTS.length;
      }
      b.lastHintIdx = hintIdx;
      const line = nearestQuest
        ? BYSTANDER_HINTS[hintIdx](nearestQuest.name, b.job||'local')
        : `"Quiet shift, huh? Stay sharp out there."`;
      openBystanderChat(line, b.job, b);
    }
    if(!bumping) b.hinted = false; // resets once the player walks away, so it can trigger again later
  });
}

// ======================================================
// INTERACTIVE AREA MAP (shows the player's position and quest markers)
// ======================================================
const localMapOverlay = document.getElementById('local-map-overlay');
const radarCanvas = document.getElementById('local-map-canvas');
const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;
const RADAR_RANGE = 60; // world units shown edge-to-edge on the map
let mapMarkerHitboxes = []; // rebuilt every draw, used for click detection

function drawRadar(){
  if(!radarCtx || !player) return;
  const w = radarCanvas.width, h = radarCanvas.height, cx = w/2, cy = h/2, r = w/2 - 6;
  radarCtx.clearRect(0,0,w,h);
  mapMarkerHitboxes = [];
  radarCtx.lineWidth = 1;
  radarCtx.strokeStyle = 'rgba(255,255,255,0.12)';
  [0.35,0.7,1].forEach(f=>{
    radarCtx.beginPath(); radarCtx.arc(cx,cy,r*f,0,Math.PI*2); radarCtx.stroke();
  });
  radarCtx.font = '11px Fredoka, sans-serif';
  radarCtx.fillStyle = 'rgba(255,255,255,0.55)';
  radarCtx.textAlign = 'center';
  radarCtx.fillText('▲ AHEAD', cx, 16);
  radarCtx.textAlign = 'left';

  // the map turns with the camera, so "up" on the map is always straight ahead on screen
  const cs = Math.cos(cameraYaw), sn = Math.sin(cameraYaw);
  const scale = r/(RADAR_RANGE/2);
  const toMap = (dx,dz)=>{
    let px = cx + (dx*cs - dz*sn)*scale;
    let py = cy + (dx*sn + dz*cs)*scale;
    const d = Math.hypot(px-cx, py-cy);
    if(d > r){ px = cx + (px-cx)*(r/d); py = cy + (py-cy)*(r/d); }
    return {x:px, y:py};
  };

  // landmarks (buildings, stops...) so the player can see where things are
  radarCtx.font = '11px Fredoka, sans-serif';
  (currentLevel && currentLevel.landmarks || []).forEach(l=>{
    const p = toMap(l.x - player.position.x, l.z - player.position.z);
    radarCtx.fillStyle = 'rgba(160,184,200,0.55)';
    radarCtx.fillRect(p.x-4, p.y-4, 8, 8);
    radarCtx.fillStyle = 'rgba(200,220,232,0.85)';
    radarCtx.fillText(l.name, p.x + 8, p.y + 4);
  });

  currentBuoys.forEach(b=>{
    const done = completedIds.has(b.quest.id);
    const dx = b.group.position.x - player.position.x;
    const dz = b.group.position.z - player.position.z;
    const p = toMap(dx, dz);
    radarCtx.fillStyle = done ? 'rgba(255,255,255,0.35)' : ('#' + b.quest.color.toString(16).padStart(6,'0'));
    radarCtx.beginPath(); radarCtx.arc(p.x,p.y,7,0,Math.PI*2); radarCtx.fill();
    mapMarkerHitboxes.push({x:p.x, y:p.y, r:9, quest:b.quest, dist:Math.hypot(dx,dz), done});
  });

  // dotted guide line to the nearest quest that is not finished yet
  let near = null;
  mapMarkerHitboxes.forEach(m=>{ if(!m.done && (!near || m.dist < near.dist)) near = m; });
  if(near){
    radarCtx.setLineDash([6,6]);
    radarCtx.strokeStyle = '#FFC857'; radarCtx.lineWidth = 2;
    radarCtx.beginPath(); radarCtx.moveTo(cx,cy); radarCtx.lineTo(near.x,near.y); radarCtx.stroke();
    radarCtx.setLineDash([]);
    radarCtx.lineWidth = 1;
  }
  radarCtx.font = '12px Fredoka, sans-serif';
  radarCtx.fillStyle = '#F4F8F5';
  mapMarkerHitboxes.forEach(m=>{
    const label = m.done ? '✓ Done' : m.quest.name.replace(/"/g,'').slice(0,18) + ' · ' + Math.round(m.dist) + 'm';
    radarCtx.fillText(label, m.x + 11, m.y + 4);
  });

  // the player arrow points the way the sentinel is facing, relative to the map
  radarCtx.save();
  radarCtx.translate(cx,cy);
  radarCtx.rotate(Math.PI - (player.rotation.y - cameraYaw));
  radarCtx.fillStyle = '#5FD4D0';
  radarCtx.beginPath();
  radarCtx.moveTo(0,-9); radarCtx.lineTo(6,7); radarCtx.lineTo(-6,7); radarCtx.closePath();
  radarCtx.fill();
  radarCtx.restore();
}

if(radarCanvas){
  radarCanvas.addEventListener('click', e=>{
    const rect = radarCanvas.getBoundingClientRect();
    const scaleX = radarCanvas.width / rect.width, scaleY = radarCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    const hit = mapMarkerHitboxes.find(m => Math.hypot(mx-m.x, my-m.y) <= m.r + 4);
    if(hit){
      toast('info', hit.quest.name, hit.done ? 'Already handled — nice work.' : `About ${Math.round(hit.dist)}m away.`, 2600);
    }
  });
}
document.getElementById('local-map-btn').onclick = ()=>{
  localMapOverlay.classList.remove('hidden');
  drawRadar();
};
document.getElementById('local-map-close-btn').onclick = ()=>{
  localMapOverlay.classList.add('hidden');
};

// ======================================================
// CROWD VARIETY — mixed-looking background people, per-setting outfits,
// and small ambient conversations between them so each posting feels alive
// ======================================================
const HAIR_STYLE_IDS = ['none','short','long','mohawk'];
const BYSTANDER_JOBS = ['jogger','dog walker','commuter','delivery courier','shopper','student','tourist','vendor','office worker','local resident'];

// canvas helpers shared by speech bubbles and the "suspicious?" sign
function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){
  const words = text.split(' ');
  let line='', yy=y;
  words.forEach(w=>{
    const test = line + w + ' ';
    if(ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, yy); line = w+' '; yy += lineHeight;
    } else line = test;
  });
  ctx.fillText(line, x, yy);
  return yy + lineHeight;
}

// a small floating speech-bubble sprite, used for bystander-to-bystander chatter
function makeSpeechSprite(text){
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  const draw = (t)=>{
    ctx.clearRect(0,0,320,128);
    ctx.fillStyle = 'rgba(19,36,51,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
    roundRectPath(ctx,6,6,308,80,16); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(44,86); ctx.lineTo(64,86); ctx.lineTo(40,112); ctx.closePath();
    ctx.fillStyle = 'rgba(19,36,51,0.92)'; ctx.fill();
    ctx.fillStyle = '#F4F8F5';
    ctx.font = '600 20px Fredoka, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    wrapCanvasText(ctx, t, 22, 24, 276, 24);
    tex.needsUpdate = true;
  };
  draw(text);
  const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false});
  const spr = new THREE.Sprite(mat);
  spr.scale.set(3.4, 1.36, 1);
  spr.renderOrder = 999;
  spr.userData.setText = draw;
  return spr;
}

// made-up "talking" noises for the bubbles above people who are chatting to each other
const GIBBER = ['bla','mu','ra','ko','ti','na','sho','em','po','la','ha','hmm','eh','dun','pa','ya','wee','tok'];
function gibberish(){
  const n = 3 + Math.floor(Math.random()*3), out = [];
  for(let i=0;i<n;i++){
    let w = GIBBER[Math.floor(Math.random()*GIBBER.length)];
    if(Math.random() < 0.5) w += GIBBER[Math.floor(Math.random()*GIBBER.length)];
    out.push(w);
  }
  const end = ['...','?!','.','!?','…'][Math.floor(Math.random()*5)];
  const str = out.join(' ') + end;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function disposeSprite(spr){
  if(!spr) return;
  if(spr.parent) spr.parent.remove(spr);
  if(spr.material){ if(spr.material.map) spr.material.map.dispose(); spr.material.dispose(); }
}

// the floating "Suspicious?" sign that hovers over quest NPCs, Roblox/Pet-Society style
function makeSuspiciousSign(){
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(19,36,51,0.92)';
  ctx.fillRect(72,102,16,60);
  ctx.fillStyle = '#FFC857';
  roundRectPath(ctx,8,8,144,96,20); ctx.fill();
  ctx.strokeStyle = 'rgba(19,36,51,0.9)'; ctx.lineWidth = 5;
  roundRectPath(ctx,8,8,144,96,20); ctx.stroke();
  ctx.fillStyle = '#132433';
  ctx.font = '800 64px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', 80, 54);
  ctx.font = '700 15px Fredoka, sans-serif';
  ctx.fillText('SUSPICIOUS', 80, 90);
  const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, opacity:0});
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.55, 1.75, 1);
  spr.renderOrder = 998;
  return spr;
}

// spawns a small crowd of visually varied people (different skin tones, hair,
// face shapes and outfits) at the given spots, each with a short walking loop
// and an occasional ambient chat with a neighbor
function spawnBystanders(scene, env, spots, chatLines, opts){
  opts = opts || {};
  const shirts = opts.shirts || SHIRT_COLORS;
  const pants = opts.pants || PANTS_COLORS;
  env.bystanders = env.bystanders || [];
  spots.forEach(([x,z], i)=>{
    const skin = SKIN_COLORS[Math.floor(Math.random()*SKIN_COLORS.length)];
    const shirt = shirts[Math.floor(Math.random()*shirts.length)];
    const pant = pants[Math.floor(Math.random()*pants.length)];
    const face = FACE_SHAPES[Math.floor(Math.random()*FACE_SHAPES.length)][0];
    const hair = HAIR_STYLE_IDS[Math.floor(Math.random()*HAIR_STYLE_IDS.length)];
    const hairColor = HAIR_COLORS[Math.floor(Math.random()*HAIR_COLORS.length)];
    const p = makeLegoFigure(shirt, pant, skin, face, hair, hairColor);
    p.position.set(x,0,z);
    p.rotation.y = Math.random()*Math.PI*2;
    p.userData.baseRotY = p.rotation.y;
    scene.add(p);
    // small walking loop around their starting spot, so the street feels alive
    const patrol = [
      {x:x,   z:z},
      {x:x+THREE.MathUtils.randFloat(3,5), z:z},
      {x:x+THREE.MathUtils.randFloat(3,5), z:z+THREE.MathUtils.randFloat(2,4)},
      {x:x,   z:z+THREE.MathUtils.randFloat(2,4)}
    ];
    env.bystanders.push({
      group:p, phase:i*1.9, patrol, patrolIndex:0, patrolSpeed:1.0+Math.random()*0.7,
      job: BYSTANDER_JOBS[Math.floor(Math.random()*BYSTANDER_JOBS.length)],
      chatLines: chatLines || GENERIC_CHATTER,
      chatCooldown: THREE.MathUtils.randFloat(5,16), chatting:false, chatSprite:null, recentConvo:[]
    });
  });
}

// picks nearby, free bystanders and has them pause to talk to each other —
// a short two-line exchange shown as speech bubbles, so passersby aren't just
// scenery but actually interact with one another
function updateBystanderChatter(env, dt){
  if(!env || !env.bystanders) return;
  const list = env.bystanders;
  env.chats = env.chats || [];

  // run the conversations that are already going
  for(let i=env.chats.length-1;i>=0;i--){
    const c = env.chats[i];
    c.t += dt;
    const turn = Math.floor(c.t / 2.6);
    if(turn >= 2){                                   // each person gets one turn, then they walk on
      disposeSprite(c.spr);
      c.a.chatting = false; c.b.chatting = false;
      env.chats.splice(i,1);
      continue;
    }
    const speaker = turn === 0 ? c.a : c.b;
    const into = c.t - turn*2.6;
    let text;
    if(into < 0.7){
      text = '.'.repeat(1 + Math.floor(into*6) % 3);          // "..." first
    } else {
      c.tick += dt;
      if(!c.text || c.tick > 0.45){ c.tick = 0; c.text = gibberish(); }   // then made-up talking
      text = c.text;
    }
    if(text !== c.shown){ c.shown = text; c.spr.userData.setText(text); }
    c.spr.position.set(speaker.group.position.x, 3.0, speaker.group.position.z);
  }

  list.forEach(b=>{ if(!b.chatting) b.chatCooldown -= dt; });
  for(let i=0;i<list.length;i++){
    const a = list[i];
    if(a.chatting || a.chatCooldown > 0) continue;
    for(let j=i+1;j<list.length;j++){
      const o = list[j];
      if(o.chatting || o.chatCooldown > 0) continue;
      const d = Math.hypot(a.group.position.x-o.group.position.x, a.group.position.z-o.group.position.z);
      if(d < 4.5){ startBystanderChat(env, a, o); break; }
    }
  }
}
// avoids repeating a line either of the two people just used recently, so the
// same conversation doesn't loop back-to-back


function startBystanderChat(env, a, b){
  a.chatting = true; b.chatting = true;
  a.chatCooldown = THREE.MathUtils.randFloat(28,55);
  b.chatCooldown = THREE.MathUtils.randFloat(28,55);
  const ang = Math.atan2(b.group.position.x - a.group.position.x, b.group.position.z - a.group.position.z);
  a.group.rotation.y = ang; b.group.rotation.y = ang + Math.PI;     // they face each other
  a.group.userData.baseRotY = a.group.rotation.y; b.group.userData.baseRotY = b.group.rotation.y;
  const spr = makeSpeechSprite('.');
  spr.position.set(a.group.position.x, 3.0, a.group.position.z);
  scene.add(spr);
  env.chats.push({a, b, spr, t:0, tick:0, text:''});
}

const CITY_CHATTER = [
  ["Busy block tonight, huh?", "Tell me about it — third time round for me."],
  ["You catching the next train?", "Yeah, running a little late."],
  ["Cold one out here.", "Should've brought a jacket, honestly."],
  ["Any good food trucks still open?", "The taco one on the corner, usually."],
  ["Traffic's brutal on this street.", "Every single night, I swear."],
  ["You live around here?", "Couple blocks over, yeah."],
  ["That new café open yet?", "Not till next week, I heard."],
  ["Long walk home tonight.", "Same — might just grab a cab."],
  ["Quiet for a weeknight.", "Give it an hour, it'll pick up."],
  ["Nice night for it, at least.", "Can't argue with that."],
  ["Ang haba ng traffic dito.", "Oo nga, sumasakit na ulo ko."],
  ["Sakay ka na ba ng jeep pauwi?", "Mamaya pa, hihintayin ko lang kasama ko."],
  ["Gutom na ako, dumaan tayo sa carinderia?", "Sige, malapit lang naman."],
  ["Ang lamig ng hangin ngayong gabi.", "Dapat nagdala ako ng jacket."],
  ["Tara, ihatid na kita sa terminal.", "Salamat, medyo malayo pa lakarin."],
  ["Bagong tindahan ba yun sa kanto?", "Oo, kakabukas lang last week."]
];
const BEACH_CHATTER = [
  ["Water's warm today.", "Perfect for a swim later."],
  ["Did you save us a spot near the shade?", "Right by the blue umbrella."],
  ["Tide's coming in fast.", "Good excuse for a break, honestly."],
  ["Great day for it.", "Best one all week."],
  ["You catch the sunrise this morning?", "Wouldn't miss it."],
  ["Sand's packed today.", "Everyone had the same idea."],
  ["Lifeguard said the current's a bit strong.", "Good thing to know before we swim."],
  ["Smells like someone's grilling nearby.", "Now I'm hungry too."],
  ["Forgot sunscreen, of course.", "Classic — share mine."],
  ["Waves look good for later.", "Might grab a board after lunch."],
  ["Ang init talaga ngayon, ano?", "Oo, sunblock na tayo ulit."],
  ["Tara, sisid tayo mamaya.", "Sige, pagkatapos lang kumain."],
  ["Ang saya ng dagat ngayon.", "Tahimik din kasi, di masyadong maalon."],
  ["May grilled na isda doon sa may resort.", "Sige, bilhin natin mamaya."],
  ["Uuwi na kaya tayo bago dumilim?", "Konti na lang, i-enjoy muna natin."]
];
const OFFICE_CHATTER = [
  ["Meeting ran long again.", "When does it not."],
  ["Coffee machine's fixed, finally.", "Thank goodness, I was suffering."],
  ["Heading to the breakroom?", "Yeah, five minutes."],
  ["Busy floor today.", "Everyone's chasing the same deadline."],
  ["Did the printer get fixed?", "Still jamming on floor two."],
  ["You on the new project?", "Just got looped in yesterday."],
  ["Elevator's slow again.", "Stairs are honestly faster."],
  ["Any word on the town hall?", "Supposedly next Friday."],
  ["Working late tonight?", "Trying not to, for once."],
  ["Lunch order's in, by the way.", "Perfect timing, I'm starving."],
  ["Ang tagal na naman ng meeting natin.", "Sanay na ako, dati pa ganyan."],
  ["Kumain ka na ba?", "Hindi pa, dito lang muna sa break room."],
  ["Deadline ba ito bukas?", "Oo, kailangan tapusin ngayong gabi."],
  ["Sira na naman ba yung printer?", "Oo, third time na this week."],
  ["Punta ka rin sa town hall meeting?", "Oo, sabay na tayo mamaya."]
];
const TOWER_CHATTER = [
  ["Lobby's packed this morning.", "Big client visit, I heard."],
  ["Lift's slow today.", "Take the stairs, it's faster."],
  ["Cold in here.", "AC's been like that all week."],
  ["Long day ahead.", "Aren't they all."],
  ["Security's extra thorough today.", "Probably the client visit."],
  ["Visiting someone on twelve?", "Yeah, quick meeting."],
  ["Badge reader's acting up again.", "Third time this week for me."],
  ["Nice view from up top, at least.", "Best part of the building, honestly."],
  ["Rain's supposed to start later.", "Glad I brought an umbrella then."],
  ["Building's quieter than usual.", "Half the floor's out today."],
  ["Ang bagal ng elevator ngayon.", "Tara na lang sa hagdan."],
  ["Sino bang bisita natin ngayon?", "Client daw galing sa ibang branch."],
  ["Ang lamig ng lobby dito.", "Oo, sobrang lakas ng aircon."],
  ["Uulan daw mamaya.", "Buti nagdala ako ng payong."]
];
const GENERIC_CHATTER = [
  ["Nice weather we're having.", "Can't complain."],
  ["Busy day out here.", "Always is."],
  ["Long one today.", "Tell me about it."],
  ["Anything new going on?", "Not really, same as always."],
  ["Kamusta ka na?", "Ayos naman, ikaw?"],
  ["Ang init ngayon, ano?", "Oo nga, sana bumuti mamaya."]
];

function makeNPC(quest){
  const skin = SKIN_COLORS[Math.floor(Math.random()*SKIN_COLORS.length)];
  const face = FACE_SHAPES[Math.floor(Math.random()*FACE_SHAPES.length)][0];
  const hair = HAIR_STYLE_IDS[Math.floor(Math.random()*HAIR_STYLE_IDS.length)];
  const hairColor = HAIR_COLORS[Math.floor(Math.random()*HAIR_COLORS.length)];
  const g = makeLegoFigure(quest.color, 0x33383F, skin, face, hair, hairColor);
  const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.55,0.16,10,20), new THREE.MeshStandardMaterial({color: quest.color, emissive: quest.color, emissiveIntensity:0.6}));
  buoy.position.y = 3.2; buoy.rotation.x = Math.PI/2; g.add(buoy);
  const glow = new THREE.PointLight(quest.color, 1.1, 8);
  glow.position.y = 3.2; g.add(glow);
  const sign = makeSuspiciousSign();
  sign.position.y = 4.15;
  g.add(sign);
  g.position.set(quest.pos.x, 0, quest.pos.z);
  scene.add(g);

  // Pathfinding: use a quest-defined patrol route if present, otherwise
  // auto-generate a small square loop around the NPC's starting position.
  const px = quest.pos.x, pz = quest.pos.z;
  const patrol = quest.patrol || [
    {x:px,   z:pz},
    {x:px+3, z:pz},
    {x:px+3, z:pz+3},
    {x:px,   z:pz+3}
  ];

  currentBuoys.push({group:g, buoy, glow, sign, quest, baseY:3.2, patrol, patrolIndex:0, patrolSpeed:2.4, noticed:false});
}

// ======================================================
// PATHFINDING (waypoint navigation for quest NPCs)
// ======================================================
function updateNPCPatrol(b, dt){
  // while this NPC is talking to the player, stop walking and turn to face them
  if(dialogueOpen && activeQuest && activeQuest.id === b.quest.id){
    faceTowardPlayer(b.group, dt);
    animateFigure(b.group, dt, false, clock.elapsedTime, 0);
    return;
  }
  if(!b.patrol || completedIds.has(b.quest.id)) return; // stop once solved

  const target = b.patrol[b.patrolIndex];
  const dx = target.x - b.group.position.x;
  const dz = target.z - b.group.position.z;
  const dist = Math.hypot(dx, dz);
  if(dist < 0.3){
    b.patrolIndex = (b.patrolIndex + 1) % b.patrol.length;
    return;
  }
  const mx = dx/dist, mz = dz/dist;
  b.group.position.x += mx * b.patrolSpeed * dt;
  b.group.position.z += mz * b.patrolSpeed * dt;
  const targetRot = Math.atan2(mx, mz);
  let diff = targetRot - b.group.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  b.group.rotation.y += diff * Math.min(1, dt*6);
  animateFigure(b.group, dt, true, clock.elapsedTime, 0);
}

// ======================================================
// MOVEMENT
// ======================================================
const keys = {};
window.addEventListener('keydown', e=>{
  if((e.key === 'Enter' || e.key === ' ') && typingFinish){ e.preventDefault(); skipTyping(); return; }
  keys[e.key.toLowerCase()] = true;
  if(e.key === ' '){ e.preventDefault(); requestJump(); }
});
window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()] = false; });
const touchState = {up:false,down:false,left:false,right:false};
function bindTouch(id, key){
  const el = document.getElementById(id);
  const set = v => (e)=>{ e.preventDefault(); touchState[key]=v; };
  el.addEventListener('touchstart', set(true)); el.addEventListener('touchend', set(false));
  el.addEventListener('mousedown', set(true)); el.addEventListener('mouseup', set(false)); el.addEventListener('mouseleave', set(false));
}
bindTouch('btn-up','up'); bindTouch('btn-down','down'); bindTouch('btn-left','left'); bindTouch('btn-right','right');
document.getElementById('btn-jump').addEventListener('touchstart', e=>{ e.preventDefault(); requestJump(); });
document.getElementById('btn-jump').addEventListener('mousedown', ()=> requestJump());
document.getElementById('audio-btn').addEventListener('click', ()=>{
  audioEnabled = !audioEnabled;
  document.getElementById('audio-btn').textContent = audioEnabled ? '🔊' : '🔇';
  if(audioEnabled) ensureAudio();
});

const MOVE_SPEED = 9.5;
let nearestQuest = null;

let stepTimer = 0;
let cameraShakeTime = 0;

// ======================================================
// CAMERA LOOK-AROUND (drag to orbit 360° around the player)
// Movement (WASD) stays fixed to world directions — only the
// viewing angle rotates. Works with mouse drag or a touch drag.
// ======================================================
let cameraYaw = 0;
const CAMERA_RADIUS = 17, CAMERA_HEIGHT = 15, CAMERA_DRAG_SPEED = 0.006;
let camDragging = false, camDragLastX = 0, camDragPointerId = null;
canvas.addEventListener('pointerdown', e=>{
  if(dialogueOpen || hubOpen || pauseOpen || customizeOpen || !player) return;
  camDragging = true; camDragLastX = e.clientX; camDragPointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e=>{
  if(!camDragging || e.pointerId !== camDragPointerId) return;
  cameraYaw -= (e.clientX - camDragLastX) * CAMERA_DRAG_SPEED;
  camDragLastX = e.clientX;
});
function endCameraDrag(e){
  if(e.pointerId !== camDragPointerId) return;
  camDragging = false; camDragPointerId = null;
}
canvas.addEventListener('pointerup', endCameraDrag);
canvas.addEventListener('pointercancel', endCameraDrag);

// ======================================================
// SOLID OBJECTS: vehicles, buildings and street furniture the sentinel cannot walk through.
// env.solids holds boxes (hx / hz are the half sizes, turned by rot) and circles (r).
// A box can follow a live group, so moving traffic stays solid. h is the object's height:
// low things (bins, benches) can be jumped over, vehicles and buildings cannot.
// ======================================================
const PLAYER_RADIUS = 0.5;
function solidPose(s){
  if(s.group) return { x:s.group.position.x, z:s.group.position.z, rot:s.group.rotation.y };
  return { x:s.x, z:s.z, rot:s.rot || 0 };
}
// pushes point p out of solid s if the player circle overlaps it; returns true when it moved p
function pushOutOf(s, p, R){
  const pose = solidPose(s);
  const dx = p.x - pose.x, dz = p.z - pose.z;
  if(s.r){
    const d = Math.hypot(dx,dz), min = s.r + R;
    if(d >= min) return false;
    const nx = d > 1e-4 ? dx/d : 1, nz = d > 1e-4 ? dz/d : 0;
    p.x = pose.x + nx*min; p.z = pose.z + nz*min;
    return true;
  }
  const c = Math.cos(pose.rot), sn = Math.sin(pose.rot);
  const lx = c*dx - sn*dz, lz = sn*dx + c*dz;              // player in the box's own space
  const qx = Math.max(-s.hx, Math.min(s.hx, lx));
  const qz = Math.max(-s.hz, Math.min(s.hz, lz));
  const ox = lx - qx, oz = lz - qz, d = Math.hypot(ox,oz);
  let nlx, nlz;
  if(d > 1e-4){
    if(d >= R) return false;
    nlx = lx + ox/d*(R-d); nlz = lz + oz/d*(R-d);
  } else {                                                  // centre is inside: leave through the nearest face
    const px = s.hx - Math.abs(lx), pz = s.hz - Math.abs(lz);
    if(px < pz){ nlx = (lx < 0 ? -1 : 1)*(s.hx + R); nlz = lz; }
    else { nlx = lx; nlz = (lz < 0 ? -1 : 1)*(s.hz + R); }
  }
  p.x = pose.x + c*nlx + sn*nlz;                            // back to world space
  p.z = pose.z - sn*nlx + c*nlz;
  return true;
}
function insideAnySolid(p, y){
  const env = currentLevel && currentLevel._env;
  if(!env || !env.solids) return false;
  for(let i=0;i<env.solids.length;i++){
    const s = env.solids[i];
    if(y > (s.h || 2.5) - 0.15) continue;
    if(pushOutOf(s, {x:p.x, z:p.z}, 0.01)) return true;
  }
  return false;
}
// prev = the last position that was known to be fine: if the sentinel is squeezed between two solids
// and cannot be pushed clear, they go back there instead of ending up inside something
function resolveSolids(p, y, prev){
  const env = currentLevel && currentLevel._env;
  if(!env || !env.solids) return;
  for(let pass=0; pass<5; pass++){
    let moved = false;
    for(let i=0;i<env.solids.length;i++){
      const s = env.solids[i];
      if(y > (s.h || 2.5) - 0.15) continue;                 // jumped right over it
      if(pushOutOf(s, p, PLAYER_RADIUS)) moved = true;
    }
    if(!moved) break;
  }
  if(prev && insideAnySolid(p, y)){ p.x = prev.x; p.z = prev.z; }
}

// ---- moving traffic: every car in a lane keeps its distance and stops for the sentinel ----
function trafficClear(env, v, x){
  return !env.vehicles.some(o=> o!==v && o.lane===v.lane && Math.abs(o.group.position.x - x) < (o.len + v.len)/2 + 3);
}
function updateTraffic(env, dt){
  if(!env || !env.vehicles) return;
  const pp = player ? player.position : null;
  env.vehicles.forEach(v=>{
    const g = v.group;
    let gap = Infinity;                                       // free road in front of this vehicle
    env.vehicles.forEach(o=>{
      if(o===v || o.lane!==v.lane) return;
      const d = (o.group.position.x - g.position.x) * v.dir;
      if(d > 0) gap = Math.min(gap, d - (o.len + v.len)/2);
    });
    if(pp){                                                   // the sentinel stepping into the lane
      const ahead = (pp.x - g.position.x) * v.dir;
      const side = Math.abs(pp.z - g.position.z);
      if(ahead > 0 && side < 1.5 + PLAYER_RADIUS) gap = Math.min(gap, ahead - v.len/2 - PLAYER_RADIUS);
    }
    const SAFE = 2.6;
    let target = v.speed;
    if(gap < SAFE + 5) target = v.speed * Math.max(0, (gap - SAFE) / 5);   // ease off, stop short
    v.cur += (target - v.cur) * Math.min(1, dt*5);
    if(v.cur < 0.03) v.cur = 0;
    g.position.x += v.dir * v.cur * dt;
    if(v.dir > 0 && g.position.x > v.xMax){
      if(trafficClear(env, v, v.xMin)) g.position.x = v.xMin; else { g.position.x = v.xMax; v.cur = 0; }
    }
    if(v.dir < 0 && g.position.x < v.xMin){
      if(trafficClear(env, v, v.xMax)) g.position.x = v.xMax; else { g.position.x = v.xMin; v.cur = 0; }
    }
  });
}

function updatePlayer(dt){
  if(dialogueOpen || hubOpen || pauseOpen || customizeOpen || !player) return;
  let mx=0, mz=0;
  if(keys['w']||keys['arrowup']||touchState.up) mz -= 1;
  if(keys['s']||keys['arrowdown']||touchState.down) mz += 1;
  if(keys['a']||keys['arrowleft']||touchState.left) mx -= 1;
  if(keys['d']||keys['arrowright']||touchState.right) mx += 1;

  const isWalking = (mx!==0||mz!==0);
  const prevPos = {x:player.position.x, z:player.position.z};
  if(isWalking){
    const len = Math.hypot(mx,mz); mx/=len; mz/=len;
    player.position.x += mx*MOVE_SPEED*dt;
    player.position.z += mz*MOVE_SPEED*dt;
    const targetRot = Math.atan2(mx, mz);
    let diff = targetRot - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff*Math.min(1, dt*10);
    player.userData.baseRotY = player.rotation.y;

    if(playerGrounded){
      stepTimer -= dt;
      if(stepTimer <= 0){ playStepSound(); stepTimer = 0.28; }
    }
  }
  animateFigure(player, dt, isWalking, clock.elapsedTime, 0);

  // jump / gravity physics
  playerVelY += GRAVITY*dt;
  playerY += playerVelY*dt;
  if(playerY <= 0){
    if(!playerGrounded && playerVelY < -3) playLandSound();
    playerY = 0; playerVelY = 0; playerGrounded = true;
  }
  player.position.y = playerY;
  const stretch = playerGrounded ? 1 : THREE.MathUtils.clamp(1 + playerVelY*0.02, 0.85, 1.2);
  player.scale.set(2-stretch, stretch, 2-stretch);

  // solid vehicles / buildings / furniture, then the edge of the map
  resolveSolids(player.position, playerY, prevPos);
  player.position.x = THREE.MathUtils.clamp(player.position.x, -BOUNDS.x, BOUNDS.x);
  player.position.z = THREE.MathUtils.clamp(player.position.z, BOUNDS.zMin, BOUNDS.zMax);

  const camTarget = new THREE.Vector3(
    player.position.x + Math.sin(cameraYaw)*CAMERA_RADIUS,
    CAMERA_HEIGHT,
    player.position.z + Math.cos(cameraYaw)*CAMERA_RADIUS
  );
  camera.position.lerp(camTarget, 1-Math.pow(0.001,dt));
  camera.lookAt(player.position.x, 1.4, player.position.z);
  if(cameraShakeTime > 0){
    cameraShakeTime -= dt;
    camera.position.x += (Math.random()-0.5)*0.25*Math.max(0,cameraShakeTime)/0.3;
    camera.position.y += (Math.random()-0.5)*0.18*Math.max(0,cameraShakeTime)/0.3;
  }

  // stud collectibles
  currentStuds.forEach(s=>{
    if(s.collected) return;
    const d = Math.hypot(player.position.x - s.mesh.position.x, player.position.z - s.mesh.position.z);
    if(d < 1.3){
      s.collected = true;
      scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
      scene.remove(s.light);
      studsCollected++;
      updateStudHUD();
      awardRunCoins(5);
      playCollectSound();
      spawnBurst(new THREE.Vector3(s.pos.x,1,s.pos.z), [0xFFC857,0xFFE9B8,0xFFFFFF], 10);
    }
  });

  nearestQuest = null;
  let bestDist = 4.2;
  currentBuoys.forEach(b=>{
    if(completedIds.has(b.quest.id)) return;
    const d = Math.hypot(player.position.x - b.group.position.x, player.position.z - b.group.position.z);
    if(d < bestDist){ bestDist = d; nearestQuest = b; }
  });
  if(nearestQuest && !dialogueOpen){ openDialogue(nearestQuest.quest); }
}

// ======================================================
// DIALOGUE UI
// ======================================================
const wrap = document.getElementById('dialogue-wrap');
const npcNameEl = document.getElementById('npc-name');
const scenarioEl = document.getElementById('dialogue-scenario');
const choicesEl = document.getElementById('dialogue-choices');
const feedbackWrap = document.getElementById('dialogue-feedback');
const feedbackTag = document.getElementById('feedback-tag');
const feedbackText = document.getElementById('feedback-text');
const continueBtn = document.getElementById('continue-btn');
const objectiveText = document.getElementById('objective-text');
wrap.addEventListener('click', ()=> skipTyping());   // tap the box to skip the talking animation

let activeQuest = null;
function openDialogue(quest){
  activeQuest = quest; dialogueOpen = true;
  wrap.classList.remove('hidden'); wrap.classList.add('show');
  feedbackWrap.classList.remove('show');
  choicesEl.style.display = 'none'; choicesEl.innerHTML = '';
  npcNameEl.textContent = quest.name;
  const noteEl = document.getElementById('dialogue-hint');
  noteEl.style.display = 'none';
  // "..." first, then scrambled letters, then the real line, as if they are speaking
  typeInto(scenarioEl, quest.scenario, ()=>{
    if(hasItem('gear-notes')){
      noteEl.textContent = 'Analyst notes: this looks like ' + quest.technique.toLowerCase() + '.';
      noteEl.style.display = 'block';
    }
    quest.choices.forEach(choice=>{
      const btn = document.createElement('button');
      btn.className = 'choice-btn'; btn.textContent = choice.text;
      btn.onclick = ()=>selectChoice(quest, choice);
      choicesEl.appendChild(btn);
    });
    choicesEl.style.display = 'flex';
  });
}

function selectChoice(quest, choice){
  choicesEl.style.display='none';
  feedbackWrap.classList.add('show');
  feedbackTag.textContent = choice.correct ? '✓ Solid instinct' : '⚠ Risky move · −1 life';
  feedbackTag.className = choice.correct ? 'correct' : 'incorrect';
  feedbackText.textContent = choice.feedback;
  const firstAnswer = !completedIds.has(quest.id);
  if(choice.correct && firstAnswer){
    levelTrustScore++; updateShells();
    const got = awardRunCoins(15);
    toast('reward','Good call', '+◈' + got + ' credits for spotting ' + quest.technique.toLowerCase() + '.', 2600);
  } else if(!choice.correct && firstAnswer){
    // a mistake costs a life
    runState.lives = Math.max(0, runState.lives - 1);
    updateRunStats();
    toast('warn','Life lost 💔', runState.lives > 0
      ? runState.lives + (runState.lives === 1 ? ' life' : ' lives') + ' left. Mag-ingat sa susunod.'
      : 'That was your last life.', 3200);
    // Blackout also burns shift time on a wrong call
    if(runState.timed && currentDifficulty.wrongPenalty > 0){
      runState.timeLeft = Math.max(1, runState.timeLeft - currentDifficulty.wrongPenalty);
      updateRunStats();
    }
  }
  completedIds.add(quest.id);
  updateObjectiveProgress();
  const b = currentBuoys.find(x=>x.quest.id===quest.id);
  if(b){ b.buoy.material.color.set(0x2FA6A1); b.buoy.material.emissive.set(0x2FA6A1); b.glow.color.set(0x2FA6A1); }

  const burstPos = new THREE.Vector3(quest.pos.x, 2.2, quest.pos.z);
  if(choice.correct){
    playCorrectSound();
    screenFlash('rgba(47,166,161,0.35)');
    spawnBurst(burstPos, [0x2FA6A1,0xFFC857,0xF4F8F5], 18);
  } else {
    playIncorrectSound();
    screenFlash('rgba(226,78,48,0.32)');
    cameraShakeTime = 0.3;
  }
}

function updateStudHUD(){
  document.getElementById('stud-count').textContent = `${studsCollected}/${totalStuds}`;
}

const objectiveProgressEl = document.getElementById('objective-progress');
const missionFillEl = document.getElementById('mission-fill');
const missionPctEl = document.getElementById('mission-pct');
function updateObjectiveProgress(){
  const total = currentLevel ? currentLevel.quests.length : 0;
  const done = Math.min(completedIds.size, total);
  const pct = total ? Math.round(done/total*100) : 0;
  if(missionFillEl) missionFillEl.style.width = pct + '%';
  if(missionPctEl) missionPctEl.textContent = pct + '%';
  if(!currentLevel || !runActive){ objectiveProgressEl.classList.remove('show','done'); return; }
  objectiveProgressEl.textContent = done + '/' + total;
  objectiveProgressEl.classList.add('show');
  objectiveProgressEl.classList.toggle('done', done >= total);
}

continueBtn.onclick = ()=>{
  wrap.classList.remove('show'); wrap.classList.add('hidden');
  dialogueOpen = false; activeQuest = null;
  if(runState.lives <= 0){ setTimeout(()=> failRun('A wrong call on your last life.'), 300); }
  else if(completedIds.size >= currentLevel.quests.length){ setTimeout(showLevelComplete, 400); }
};

// trust shells
const shellsEl = document.getElementById('shells');
function initShells(n){
  shellsEl.innerHTML='';
  for(let i=0;i<n;i++){ const d = document.createElement('div'); d.className='shell'; d.textContent='🐚'; shellsEl.appendChild(d); }
}
function updateShells(){
  const shells = shellsEl.children;
  for(let i=0;i<shells.length;i++){ shells[i].classList.toggle('filled', i < levelTrustScore); }
}

// ======================================================
// HUB
// ======================================================
const hubOverlay = document.getElementById('hub-overlay');
const levelCardsEl = document.getElementById('level-cards');
function renderHub(){
  updateCoinDisplays();
  updateNotifBadge();
  levelCardsEl.innerHTML = '';
  LEVELS.forEach((lvl, i)=>{
    const card = document.createElement('div');
    const locked = !isLevelUnlocked(i);
    const cleared = isLevelCleared(i);
    card.className = 'level-card' + (locked ? ' locked' : '');
    const statusClass = locked ? 'locked' : (cleared ? 'done' : 'play');
    const statusText = locked ? '🔒 Locked' : (cleared ? '★ Cleared' : '▶ Play');
    let chips = '';
    DIFF_IDS.forEach(d=>{
      const rec = stageRecord(lvl.id, d);
      chips += '<span class="stage-chip' + (rec.cleared ? ' cleared' : '') + '" title="' + esc(DIFFICULTIES[d].name) + '">' +
        DIFFICULTIES[d].emoji + ' ' + DIFFICULTIES[d].short +
        (rec.cleared ? ' ' + starString(rec.bestStars) : '') + '</span>';
    });
    card.innerHTML = `
      <div class="num">Posting ${i+1}</div>
      <div class="emoji">${lvl.icon}</div>
      <h3>${lvl.title}</h3>
      <p>${lvl.subtitle}</p>
      <div class="status ${statusClass}">${statusText}</div>
      <div class="stage-row">${locked ? '' : chips}</div>
    `;
    if(!locked){ card.onclick = ()=> openDifficultyPicker(i); }
    levelCardsEl.appendChild(card);
  });
}
document.getElementById('hub-shop-btn').onclick = ()=> openShop();
document.getElementById('hub-notif-btn').onclick = ()=> openNotifications();
document.getElementById('map-btn').onclick = ()=> showHub();

// Exit lives on the lobby only — never in the pause menu, so a shift in
// progress is never one accidental tap away from being abandoned.
document.getElementById('hub-exit-btn').onclick = ()=>{
  document.getElementById('exit-confirm-overlay').classList.remove('hidden');
};
document.getElementById('exit-cancel-btn').onclick = ()=>{
  document.getElementById('exit-confirm-overlay').classList.add('hidden');
};
document.getElementById('exit-confirm-btn').onclick = ()=>{
  if(userData) saveUser();
  document.getElementById('exit-confirm-overlay').classList.add('hidden');
  // window.close() only works on tabs opened by script, so this quietly
  // no-ops in most browsers/artifact viewers — either way we still return
  // to a clean sign-in state so nobody is left stuck mid-lobby.
  try{ window.close(); }catch(e){}
  showAuthScreen();
};

function showHub(){
  hubOpen = true; dialogueOpen = false; pauseOpen = false; runActive = false;
  closeWorldPicker();
  wrap.classList.remove('show'); wrap.classList.add('hidden');
  document.getElementById('complete-overlay').classList.remove('show');
  pauseOverlay.classList.add('hidden');
  localMapOverlay.classList.add('hidden');
  document.body.className = 'hub-theme';
  setGameChromeVisible(false);
  renderHub();
  hubOverlay.classList.remove('hidden');
}

// ======================================================
// PAUSE / MENU HUB
// ======================================================
const pauseOverlay = document.getElementById('pause-overlay');
function openPause(){
  if(hubOpen || dialogueOpen || customizeOpen || !player) return;
  if(document.getElementById('complete-overlay').classList.contains('show')) return;
  pauseOpen = true;
  pauseOverlay.classList.remove('hidden');
  updatePauseAudioLabel();
}
function closePause(){
  pauseOpen = false;
  pauseOverlay.classList.add('hidden');
}
function updatePauseAudioLabel(){
  document.getElementById('pause-audio-btn').textContent = audioEnabled ? '🔊 Sound: On' : '🔇 Sound: Off';
}
document.getElementById('pause-btn').addEventListener('click', ()=>{ pauseOpen ? closePause() : openPause(); });
document.getElementById('resume-btn').onclick = closePause;
document.getElementById('restart-level-btn').onclick = ()=>{
  closePause();
  if(currentLevelIndex >= 0) startLevel(currentLevelIndex, currentDifficulty.id);
};
document.getElementById('pause-customize-btn').onclick = ()=>{
  pauseOverlay.classList.add('hidden');
  showCustomizeScreen({fromPause:true});
};
document.getElementById('pause-audio-btn').onclick = ()=>{
  audioEnabled = !audioEnabled;
  document.getElementById('audio-btn').textContent = audioEnabled ? '🔊' : '🔇';
  updatePauseAudioLabel();
  if(userData){ userData.settings.audio = audioEnabled; saveUser(); }
  if(audioEnabled) ensureAudio();
};
document.getElementById('pause-map-btn').onclick = ()=>{ closePause(); showHub(); };
document.getElementById('pause-logout-btn').onclick = ()=>{
  closePause();
  if(userData) saveUser();
  showAuthScreen();
};
document.getElementById('hud-logout-btn').onclick = ()=>{
  if(dialogueOpen || !confirm('Log out now? Your progress and credits are saved first.')) return;
  if(userData) saveUser();
  showAuthScreen();
};
document.getElementById('pause-shop-btn').onclick = ()=> openShop();
window.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    const openModal = openQuickModalId();
    if(openModal){ closeQuickModal(openModal); return; }
    if(document.getElementById('world-picker')){ closeWorldPicker(); return; }
    if(customizeOpen || dialogueOpen || hubOpen || !player) return;
    if(document.getElementById('complete-overlay').classList.contains('show')) return;
    pauseOpen ? closePause() : openPause();
  }
});

// ======================================================
// LEVEL LOADING
// ======================================================
const hudH1 = document.getElementById('hud-h1');
const hudP = document.getElementById('hud-p');

function applyDifficultyLighting(){
  const d = currentDifficulty;
  // some worlds carry a lightScale below 1 to tone down glare (shiny / washed-out looking floors)
  const ls = (currentLevel && currentLevel.lightScale) || 1;
  if(hemi) hemi.intensity = d.hemi * ls;
  if(sunLight){ sunLight.intensity = d.sun * ls; sunLight.castShadow = d.shadows; }
  if(fillLight) fillLight.intensity = d.ambient * ls;
  if(playerLight){ playerLight.intensity = d.playerLight; playerLight.distance = d.playerLightDist; }
  if(playerSpot){
    const lumen = hasItem('gear-lumen');
    playerSpot.intensity = d.flashlight * (lumen ? 1.55 : 1);
    playerSpot.angle = Math.min(1.2, d.flashAngle * (lumen ? 1.3 : 1));
    playerSpot.distance = d.flashDist * (lumen ? 1.35 : 1);
  }
}

// total clock for one life (the Extra hour gear adds 45 seconds)
function shiftLength(){
  return currentDifficulty.timeLimit + (hasItem('gear-timebank') ? 45 : 0);
}

function updateRunStats(){
  const dp = document.getElementById('pill-diff');
  if(dp) dp.textContent = currentDifficulty.emoji + ' ' + currentDifficulty.short;
  const cp = document.getElementById('pill-coins');
  if(cp) cp.innerHTML = gem('+' + runState.coins);
  const lp = document.getElementById('pill-lives');
  if(lp){
    const lives = Math.max(0, runState.lives || 0);
    lp.textContent = '❤️'.repeat(lives) + '🖤'.repeat(3 - lives);
  }
  const t = document.getElementById('pill-timer');
  if(!t) return;
  if(runState.timed){
    t.classList.remove('hidden');
    const s = Math.max(0, Math.ceil(runState.timeLeft));
    t.textContent = '⏱ ' + Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
    t.classList.toggle('urgent', s <= 30);
  } else {
    t.classList.add('hidden');
  }
}

function awardRunCoins(base){
  const mult = currentDifficulty.coinMult * (hasItem('gear-stipend') ? 1.25 : 1);
  const amount = Math.max(1, Math.round(base * mult));
  runState.coins += amount;
  addCoins(amount);
  updateRunStats();
  return amount;
}

function loadLevel(idx, diffId){
  currentLevelIndex = idx;
  currentLevel = LEVELS[idx];
  currentDifficulty = DIFFICULTIES[diffId || currentDifficulty.id || 'easy'];
  hubOpen = false;
  pauseOpen = false;
  dialogueOpen = false;
  closeWorldPicker();
  pauseOverlay.classList.add('hidden');
  hubOverlay.classList.add('hidden');
  setGameChromeVisible(true);
  document.getElementById('complete-overlay').classList.remove('show');

  clearScene();
  particles = [];
  setupLights();
  const env = {};
  currentLevel.buildEnvironment(scene, env);
  currentLevel._env = env;
  if(currentLevel.hemiSky && hemi){ hemi.color.set(currentLevel.hemiSky); hemi.groundColor.set(currentLevel.hemiGround); }
  if(currentLevel.sunColor && sunLight) sunLight.color.set(currentLevel.sunColor);

  currentBuoys = [];
  completedIds = new Set();
  levelTrustScore = 0;
  currentLevel.quests.forEach(makeNPC);

  buildPlayer();
  player.position.set(currentLevel.playerStart.x, 0, currentLevel.playerStart.z);
  BOUNDS = currentLevel.bounds;
  stepTimer = 0; cameraShakeTime = 0;

  buildStuds(currentLevel.studs || []);

  const d = currentDifficulty;
  scene.fog = new THREE.FogExp2(d.dark ? 0x04060C : currentLevel.fogColor, (currentLevel.fogDensity || 0.012) * d.fogMul);
  document.body.className = currentLevel.id + '-theme' + (d.bodyClass ? ' ' + d.bodyClass : '');

  hudH1.textContent = currentLevel.icon + ' ' + currentLevel.title;
  hudP.textContent = d.emoji + ' ' + d.name + ' · ' + currentLevel.subtitle;
  objectiveText.textContent = currentLevel.objective +
    (d.dark ? ' — torch only, so sweep slowly' : '');

  // every shift now has a clock and 3 lives
  runState = { coins:0, timed:true, lives:3, timeLeft:shiftLength() };
  runActive = true;
  completeCard.classList.remove('failed');
  applyDifficultyLighting();
  updateRunStats();
  updateObjectiveProgress();

  initShells(currentLevel.quests.length);
  updateShells();
}

function buildStuds(positions){
  currentStuds = [];
  studsCollected = 0;
  totalStuds = positions.length;
  positions.forEach(pos=>{
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.28,0.18,14), new THREE.MeshStandardMaterial({color:0xFFC857, emissive:0xFFC857, emissiveIntensity:0.5, roughness:0.3}));
    mesh.position.set(pos.x, 1.0, pos.z);
    mesh.castShadow = true;
    scene.add(mesh);
    const scanner = hasItem('gear-scanner');
    const light = new THREE.PointLight(0xFFC857, scanner ? 1.1 : 0.6, scanner ? 13 : 4);
    light.position.set(pos.x, 1.2, pos.z);
    scene.add(light);
    currentStuds.push({pos, mesh, light, collected:false});
  });
  updateStudHUD();
}

// ======================================================
// LEVEL COMPLETE / GAME COMPLETE
// ======================================================
const completeOverlay = document.getElementById('complete-overlay');
const completeCard = document.getElementById('complete-card');
const completeHeading = document.getElementById('complete-heading');
const scoreLine = document.getElementById('score-line');
const rewardLine = document.getElementById('reward-line');
const recapList = document.getElementById('recap-list');
const continueLevelBtn = document.getElementById('continue-level-btn');
const retryLevelBtn = document.getElementById('retry-level-btn');
const mapReturnBtn = document.getElementById('map-return-btn');

function renderRecap(quests){
  recapList.innerHTML = '';
  quests.forEach((q,i)=>{
    const row = document.createElement('div');
    row.className = 'recap-item';
    row.innerHTML = `<div class="num">${i+1}</div><div class="body"><b>${q.technique}</b><span>${q.tip}</span></div>`;
    recapList.appendChild(row);
  });
}

function showLevelComplete(){
  if(!runActive) return;
  runActive = false;

  const total = currentLevel.quests.length;
  const allCorrect = levelTrustScore === total;
  const allStuds = totalStuds > 0 ? studsCollected === totalStuds : true;
  let stars = 1;
  if(allCorrect) stars++;
  if(allStuds) stars++;

  const rec = stageRecord(currentLevel.id, currentDifficulty.id);
  const firstClear = !rec.cleared;
  rec.plays++;
  rec.cleared = true;
  rec.bestCorrect = Math.max(rec.bestCorrect, levelTrustScore);
  rec.bestStars = Math.max(rec.bestStars, stars);
  if(runState.timed) rec.bestTime = Math.max(rec.bestTime || 0, Math.round(runState.timeLeft));

  awardRunCoins(35 + (firstClear ? 60 : 0) + (allCorrect ? 25 : 0));

  const hasNext = currentLevelIndex + 1 < LEVELS.length;
  let unlockedNow = null;
  if(hasNext && !userData.progress.unlocked[LEVELS[currentLevelIndex+1].id]){
    userData.progress.unlocked[LEVELS[currentLevelIndex+1].id] = true;
    unlockedNow = LEVELS[currentLevelIndex+1];
  }
  saveUser();

  playFanfare();
  if(player){
    const p = player.position;
    spawnBurst(new THREE.Vector3(p.x, 2.5, p.z), [0xFFC857,0x2FA6A1,0xFF6B4A,0xF4F8F5], hasNext ? 26 : 44);
  }

  const allCleared = LEVELS.every((l,i)=> isLevelCleared(i));
  completeCard.classList.remove('failed');
  completeHeading.textContent = allCleared && !hasNext
    ? 'Every posting cleared 🛡️'
    : `${currentLevel.title} cleared on ${currentDifficulty.name} ${currentDifficulty.emoji}`;
  scoreLine.textContent =
    `You called ${levelTrustScore} of ${total} scenarios correctly and collected ${studsCollected} of ${totalStuds} evidence chips.`;

  // the payout uses the same diamond icon as the rest of the game
  rewardLine.innerHTML =
    '<span class="reward-chip stars">' + starString(stars) + '</span>' +
    '<span class="reward-chip">' + gem(runState.coins) + ' earned this shift</span>' +
    '<span class="reward-chip">' + gem(coinsBalance()) + ' total</span>' +
    (firstClear ? '<span class="reward-chip">First clear bonus</span>' : '');

  renderRecap(hasNext ? currentLevel.quests : LEVELS.flatMap(l=>l.quests));

  continueLevelBtn.style.display = hasNext ? 'block' : 'none';
  continueLevelBtn.textContent = hasNext ? `Continue to ${LEVELS[currentLevelIndex+1].title} →` : '';
  retryLevelBtn.style.display = 'block';
  retryLevelBtn.textContent = 'Run this shift again';
  completeOverlay.classList.add('show');
  objectiveText.textContent = hasNext
    ? 'Posting cleared — head back to the map or push on.'
    : 'All postings cleared. Nice work, Sentinel.';
  objectiveProgressEl.classList.remove('show','done');

  notify('reward', currentLevel.title + ' cleared',
    currentDifficulty.name + ' · ' + starString(stars) + ' · ◈' + runState.coins + ' earned.');
  if(unlockedNow) notify('success','New posting unlocked', unlockedNow.title + ' is now open on the map.');
}

function failRun(reason){
  if(!runActive) return;
  runActive = false;
  const rec = stageRecord(currentLevel.id, currentDifficulty.id);
  rec.plays++;
  rec.bestCorrect = Math.max(rec.bestCorrect, levelTrustScore);
  saveUser();

  playIncorrectSound();
  screenFlash('rgba(226,78,48,0.4)');
  completeCard.classList.add('failed');
  completeHeading.textContent = 'Game Over 💔';
  scoreLine.textContent = reason + ` You cleared ${levelTrustScore} of ${currentLevel.quests.length} scenarios.`;
  rewardLine.innerHTML =
    '<span class="reward-chip">' + gem(runState.coins) + ' kept from this shift</span>' +
    '<span class="reward-chip">' + gem(coinsBalance()) + ' total</span>';
  renderRecap(currentLevel.quests.filter(q=> !completedIds.has(q.id)));

  continueLevelBtn.style.display = 'none';
  retryLevelBtn.style.display = 'block';
  retryLevelBtn.textContent = 'Try the shift again';
  completeOverlay.classList.add('show');
  objectiveText.textContent = 'Game over — all 3 lives are gone.';
  objectiveProgressEl.classList.remove('show','done');
  notify('warn','Game over', currentLevel.title + ' on ' + currentDifficulty.name + ' ended: all 3 lives were lost. Credits earned were kept.');
}

continueLevelBtn.onclick = ()=>{
  if(currentLevelIndex+1 < LEVELS.length){
    completeOverlay.classList.remove('show');
    startLevel(currentLevelIndex+1, currentDifficulty.id);
  }
};
retryLevelBtn.onclick = ()=>{
  completeOverlay.classList.remove('show');
  startLevel(currentLevelIndex, currentDifficulty.id);
};
mapReturnBtn.onclick = ()=> showHub();

// ======================================================
// ANIMATE
// ======================================================
const clock = new THREE.Clock();
let lastShownSecond = -1;
function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updatePlayer(dt);

  // shift clock + lives: running out of time costs one life and restarts the clock
  if(runActive && runState.timed && !pauseOpen && !hubOpen && !dialogueOpen && !customizeOpen){
    runState.timeLeft -= dt;
    const s = Math.max(0, Math.ceil(runState.timeLeft));
    if(s !== lastShownSecond){ lastShownSecond = s; updateRunStats(); }
    if(runState.timeLeft <= 0){
      runState.lives--;
      if(runState.lives > 0){
        runState.timeLeft = shiftLength();
        playIncorrectSound(); screenFlash('rgba(226,78,48,0.4)'); cameraShakeTime = 0.3;
        toast('warn','Life lost 💔', runState.lives + (runState.lives === 1 ? ' life' : ' lives') + ' left. Bilisan mo!', 3200);
        updateRunStats();
      } else {
        runState.timeLeft = 0; updateRunStats();
        failRun('Ran out of time and out of lives.');
      }
    }
  }

  if(!pauseOpen){
    // The Void: slow rotation on rings and the core, drifting shards
    if(currentLevel && currentLevel._env){
      const e = currentLevel._env;
      if(e.spin) e.spin.forEach(s=>{
        s.obj.rotation.x += s.sx*dt; s.obj.rotation.y += s.sy*dt; s.obj.rotation.z += s.sz*dt;
      });
      if(e.drift) e.drift.forEach(d=>{
        d.obj.position.y = d.base + Math.sin(t*d.speed + d.phase)*d.amp;
        d.obj.rotation.x += dt*d.spin; d.obj.rotation.y += dt*d.spin*0.7;
      });
    }
    if(currentLevel && currentLevel.id === 'beach' && currentLevel._env && currentLevel._env.ocean){
      const ocean = currentLevel._env.ocean;
      const base = currentLevel._env.oceanBase;
      const posAttr = ocean.geometry.attributes.position;
      for(let i=0;i<posAttr.count;i++){
        const bx = base[i*3], by = base[i*3+1];
        const wave = Math.sin(bx*0.15 + t*1.3)*0.35 + Math.cos(by*0.2 + t*0.9)*0.25;
        posAttr.setZ(i, wave);
      }
      posAttr.needsUpdate = true;
      ocean.geometry.computeVertexNormals();
    }
    if(currentLevel && currentLevel._env && currentLevel._env.sky){
      currentLevel._env.sky.scale.setScalar(1 + Math.sin(t*0.6)*0.05);
    }

    if(currentLevel && currentLevel._env && currentLevel._env.bystanders){
      currentLevel._env.bystanders.forEach(b=> updateBystanderWalk(b, dt, t));
      updateBystanderHints();
      updateBystanderChatter(currentLevel._env, dt);
    }

    if(currentLevel && currentLevel._env && currentLevel._env.vehicles){
      updateTraffic(currentLevel._env, dt);
    }

    currentBuoys.forEach((b,i)=>{
      b.buoy.position.y = b.baseY + Math.sin(t*1.8 + i)*0.18;
      b.buoy.rotation.z += dt*0.6;
      const pulse = 0.5 + Math.sin(t*2.4+i)*0.25;

      // Proximity-based tell: the ring stays small/dim from a distance and
      // only becomes clearly visible as the player closes in — encouraging
      // observation before deciding whether to approach.
      const NOTICE_RADIUS = 9;
      const dPlayer = Math.hypot(player.position.x-b.group.position.x, player.position.z-b.group.position.z);
      const proximity = completedIds.has(b.quest.id) ? 1 : THREE.MathUtils.clamp(1 - (dPlayer/NOTICE_RADIUS), 0, 1);
      b.buoy.scale.setScalar(0.35 + proximity*0.65);
      b.glow.intensity = completedIds.has(b.quest.id) ? 0.6 : proximity*(0.8+pulse);
      if(b.sign){
        b.sign.material.opacity = completedIds.has(b.quest.id) ? 0 : proximity*0.95;
        b.sign.position.y = 4.15 + Math.sin(t*1.6+i)*0.08;
      }

      if(!b.noticed && proximity > 0.4 && !completedIds.has(b.quest.id)){
        b.noticed = true;
        playNoticeSound();
      }
      if(proximity <= 0.4) b.noticed = false;

      updateNPCPatrol(b, dt);
      if(!b.patrol || completedIds.has(b.quest.id)) animateFigure(b.group, dt, false, t, i*1.7);
    });

    currentStuds.forEach((s,i)=>{
      if(s.collected) return;
      s.mesh.position.y = 1.0 + Math.sin(t*2.2+i)*0.12;
      s.mesh.rotation.y += dt*1.8;
    });

    updateParticles(dt);
  }

  if(!localMapOverlay.classList.contains('hidden')) drawRadar();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
refreshAuthNote();
const lastUser = DB.getLastUser();
if(lastUser) authUsername.value = lastUser;
showLoading('Security Quest', 'Loading the field kit', 1700, ()=> showAuthScreen());

})();
