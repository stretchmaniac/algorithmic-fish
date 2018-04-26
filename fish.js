$(() => {
  initWorkers();
  initFood();
  initFish();
  initStats();
  initRunLoop();
  initScreen();
})

/* fish object:
{
  pos: 2 element array, position of center of mass
  vel: real, velocity of center of mass in direction angle (decreases with time due ot viscosity of fluid)
  angle: real, an angle from the horizontal
  angularVel: real, angular velocity of fish
  acc: linear acceleration,
  angAcc: angular acceleration
  health: self descriptive, when zero the fish dies, when after a certain threshold the fish reproduces
  age: in seconds
  generation
  networkOutput: the networks are evaluated previously, so this stores the result temporarily
  worker: the worker that manages the network for this fish
  dna: a string encoding the neural network (for mutation)
  network: a neural network mapping the inputs (positions of fish, positions of food, self object) to an output (acceleration, rotation)
    layers: array of 2d arrays of wieghts relating the weight of the input from the previous layer to the current layer
}
*/
let fish = [];
let display = {
  screenOn:true,
  stepsSinceLastSecond:0,
  secondCounter:0
}
let stats = {
  popSizes:[[],[]],
  foodSizes:[[],[]],
  velSizes:[[],[]],
  secondCounter:0
};
let environment = {
  fishToFoodConversion: 1, // how much food does a fish leave behind when it dies
  linearAccelerationHealthCost: .1, // cost of accelerating 1 (distance unit)/(time unit)^2 for 1 time unit
  angularAccelerationHealthCost: .1, // cost of accelerating 1 rad / (time unit)^2 for 1 time unit
  linearViscosity: 1, // every unit time, the velocity of an unaccelerating fish decreases by a factor linearViscosity
  angularViscosity: .2, // every unit time, the angular velocity of an unaccelerating fish decreases by a factor angularViscosity
  timeHealthDecrease: .002, // every time step, every fish loses tieHealthDecrease health
  foodPickupRadius: .005,
  foodSightRadius: .15, // how far away the fish can see food
  foodRegeneration: .2,
  saveGenerationCounter:0,
  initialFishCount:15,
  initialFoodCount:200,
  fishReproductionHealth: 2,
  autoFishSpawn:false,
  // when there is less than a certain number of fish, fish can't die
  autoImmortalFish:true,
  network:{
    width: 10, // nodes across the network
    // food require 3 slots, fish 6
    foodStart: 0, // buffer offset to start food data
    foodWidth: 3,
    fishStart: 3, // buffer offset to start fish data
    fishWidth: 3,
    selfStart: 6, // buffer offset to start self data
    selfWidth: 1,
    depth: 10, // number of layers in the network
    usableOutputValues:5
  },
  mutation:{
    rate:.5,
    continuedRate:.5
  }
};
/* worker object
{
  fish: all the fish assigned to this worker
  worker: the webworker associated with this worker (e.g. the object)
}
*/
let workers = [];

/* food object
{
  pos: 2 element array, position of food
  pickupRadius: distance center of fish must be from food to eat the food
  magnitude: how much food this object is (can be variable)
  eaten: intermediate variable to determine if a food was eaten within a frame
}
*/
let food = [];

function initScreen(){
  document.getElementById('screen-off-button').onclick = () => {
    display.screenOn = !display.screenOn;
  }
}

function initRunLoop(){
  draw();
  let lastFrame = Date.now();

  function rawStep(){
    let t = Date.now();
    let timeSinceLastFrame = (t - lastFrame)/1000;
    let sec = (new Date()).getSeconds();
    if(sec !== display.secondCounter){
      let fps = display.stepsSinceLastSecond;
      display.stepsSinceLastSecond = 0;
      document.getElementById('fps-counter').textContent = 'fps: '+fps;
      display.secondCounter = sec;
    }
    step(.2, () => {
      if(display.screenOn){
        draw();
      }
      display.stepsSinceLastSecond++;
      lastFrame = t;
      if(display.screenOn){
        window.requestAnimationFrame(rawStep);
      }else{
        rawStep();
      }
    });
  }

  window.requestAnimationFrame(rawStep);

}

function step(dt, onFinish){
  if(fish.length < 10 && environment.autoFishSpawn){
    addRandFish();
  }
  physicsStep(dt);
  neuralNetworkStep(() => {
    fishStep(dt);
    foodStep(dt);
    // update every second
    let second = (new Date()).getSeconds();
    if(second !== stats.secondCounter){
      stats.secondCounter = second;
      statsStep(dt);
    }
    onFinish();
  });
}

function initStats(){
  Plotly.newPlot(document.getElementById('pop-graph'), [{x:[],y:[],type:'scatter'}],{title:'population'});
  Plotly.newPlot(document.getElementById('food-graph'), [{x:[],y:[],type:'scatter'}], {title:'food'});
  Plotly.newPlot(document.getElementById('vel-graph'), [{x:[],y:[],type:'scatter'}], {title:'average velocity'});
}

function statsStep(dt){
  let time = (new Date()).getTime() / 1e10;
  let popDiv = document.getElementById('pop-graph');
  let foodDiv = document.getElementById('food-graph');
  let velDiv = document.getElementById('vel-graph');

  Plotly.extendTraces(popDiv, {y:[[fish.length]],x:[[time]]}, [0]);
  Plotly.extendTraces(foodDiv, {y:[[food.length]],x:[[time]]},[0]);
  let aveVel = fish.reduce((a,b)=>a+Math.abs(b.vel), 0)/fish.length;
  Plotly.extendTraces(velDiv, {y:[[aveVel]],x:[[time]]},[0]);

  stats.popSizes[0].push(time);
  stats.popSizes[1].push(fish.length);

  stats.foodSizes[0].push(time);
  stats.foodSizes[1].push(food.length);

  stats.velSizes[0].push(time);
  stats.velSizes[1].push(aveVel);
  if(stats.popSizes[0].length > 1300){
    // reduce to 1200 (twenty minutes)
    let newLists = [];
    for(list of [stats.popSizes[0], stats.popSizes[1], stats.foodSizes[0], stats.foodSizes[1], stats.velSizes[0], stats.velSizes[1]]){
      newLists.push(list.slice(list.length-1200));
    }
    [stats.popSizes[0], stats.popSizes[1], stats.foodSizes[0], stats.foodSizes[1], stats.velSizes[0], stats.velSizes[1]] = newLists;

    // update the plot
    for(let d of [popDiv, foodDiv, velDiv]){
      Plotly.deleteTraces(d, 0);
    }
    Plotly.addTraces(popDiv, {x:stats.popSizes[0], y:stats.popSizes[1], type:'scatter'});
    Plotly.addTraces(foodDiv, {x:stats.foodSizes[0], y:stats.foodSizes[1], type:'scatter'});
    Plotly.addTraces(velDiv, {x:stats.velSizes[0], y:stats.velSizes[1],type:'scatter'});
  }
}

function foodStep(dt){
  // add a certain amount of food per second (probabilistically for dt)
  if(Math.random() / dt < environment.foodRegeneration){
    food.push(randFood());
  }
}

function physicsStep(dt){
  // move the fish by whatever parameters are needed
  for(let f of fish){
    let vVec = [Math.cos(f.angle)*f.vel, Math.sin(f.angle)*f.vel];
    f.pos = add(f.pos, scalar(dt, vVec));
    f.angle += dt * f.angularVel
    // scale the velocity by viscosity
    f.vel *= (1-environment.linearViscosity*dt);
    f.angularVel *= (1-environment.angularViscosity*dt);

    f.vel += f.acc * dt;
    f.angularVel += f.angAcc * dt;

    // move any fish off the screen to the other side of the screen
    for(j of [0,1]){
      if(f.pos[j] < 0){
        f.pos[j] = 1;
      }
      if(f.pos[j] > 1){
        f.pos[j] = 0;
      }
    }
  }
}

function neuralNetworkStep(onFinish){
  workersFinished = 0;
  for(let w of workers){
    // get the inputs from all the fish associated with this worker
    let inputs = [];
    for(let f of w.fish){
      inputs.push({
        id: f.id,
        data: getFish(f)
      });
    }
    w.worker.onmessage = (e => {
      let data = e.data;
      // assign the fish the results
      // the order is preserved
      for(let i = 0; i < w.fish.length; i++){
        w.fish[i].networkOutput = data[i];
      }
      workersFinished++;
      // if this is the last worker, return
      if(workersFinished === workers.length){
        onFinish();
      }
    });
    w.worker.postMessage(['get_fish_data', inputs]);
  }
}

function fishStep(dt){
  let pauseHealthDrop = false;
  if(environment.autoImmortalFish && fish.length < 10){
    pauseHealthDrop = true;
  }
  let maxGeneration = 0;
  for(let j = fish.length -1; j >= 0; j--){
    let f = fish[j];
    // update the generation if necessary
    if(f.generation > maxGeneration){
      maxGeneration = f.generation;
    }
    // decrease the health of the fish every step by default
    // increase the decrease of health as the age increases
    if(!pauseHealthDrop){
      f.health -= environment.timeHealthDecrease * dt * ((1/300)*(f.age - 3))**2;
    }

    f.age += dt;

    // run the neural network on the relavant information
    // we need:
    //   - nearest foodWidth / 3 food, each with x,y,magnitude
    //   - nearest fishWidth/6 fish, each with x,y,angle,health,vel,angularVel
    //   - 6 numbers for self data: x,y,angle,health,vel,angularVel

    // evaluate our network
    let networkOutput = f.networkOutput;

    let acc = networkOutput[0] / 3;
    let angAcc = networkOutput[1] / 3;

    // for use in physics
    f.acc = acc;
    f.angAcc = angAcc;

    // decrease the health for the energy spent by accelerating
    if(!pauseHealthDrop){
      f.health -= f.acc * dt * environment.linearAccelerationHealthCost;
      f.health -= f.angAcc * dt * environment.angularAccelerationHealthCost;
    }

    // determine how much food the fish has eaten
    let totalMagnitude = 0;

    let sortedFood = f.sortedFood;

    for(let possEaten of sortedFood){
      if(norm(sub(f.pos, possEaten.pos)) > environment.foodPickupRadius){
        break;
      }
      // else eat the food
      if(possEaten.eaten === false){
        totalMagnitude += possEaten.magnitude;
        possEaten.eaten = true;
      }
    }
    // splice out the right number of food
    f.health += totalMagnitude;

    // turn this fish to food if their health goes below zero
    if(f.health <= 0){
      // delete fish
      fish.splice(j, 1);
      removeFishFromWorker(f);
      // add food
      food.push({
        pos: f.pos,
        pickupRadius: environment.foodPickupRadius,
        magnitude: environment.fishToFoodConversion
      });
      continue;
    }else if(f.health > environment.fishReproductionHealth){
      // reproduce the fish, move the other fish a random distance away (within reason)
      let randOffset = scalar(2*environment.foodPickupRadius, [Math.random(), Math.random()]);
      let dnaCopy = [];
      for(let num of f.dna){
        dnaCopy.push(num);
      }
      let baby = {
        pos: add(f.pos, randOffset),
        vel: 0,
        angle:Math.random()*2*Math.PI,
        angularVel: 0,
        acc:0,
        angAcc:0,
        health: 1,
        dna: dnaCopy,
        age:0,
        id:nextID(),
        generation:f.generation + 1,
        network: {}
      };
      // mutate if needed
      // DO LATER
      // initialize the network
      if(Math.random() < environment.mutation.rate){
        mutate(baby);
        console.log('mutated!');
      }
      baby.network = dnaToNetwork(baby.dna);
      fish.push(baby);
      addFishToWorker(baby);

      f.health -= 1;
    }
  }

  // splice out the eaten food
  let newFood = [];
  for(let f of food){
    if(f.eaten === false){
      newFood.push(f);
    }
  }
  food = newFood;

  // update the generation counter
  $('#generation-counter')[0].innerHTML = 'generation: ' + maxGeneration;
  if(maxGeneration > environment.saveGenerationCounter){
    environment.saveGenerationCounter = maxGeneration;
    saveFish(fish[0]);
  }
  $('#fish-counter')[0].innerHTML = 'population: '+fish.length;
}

function mutate(f){
  // change a random weight somewhere
  function changeRandom(f){
    // change a random element in the dna
    f.dna[Math.floor(Math.random() * f.dna.length)] += (Math.random() - .5) / 5;
  }
  changeRandom(f);
  while(Math.random() < environment.mutation.continuedRate){
    changeRandom(f);
  }
}

function scale(pt, canvas){
  // transforms a environment coordinate (an element of [0,1] x [0,1]) to screen coordinates
  return [pt[0]*canvas.width, canvas.height*(1-pt[1])];
}

function draw(){
  let canvas = $('#canvas')[0];
  let ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0,0, canvas.width, canvas.height);

  ctx.fillStyle = 'black';
  ctx.beginPath();
  for(let f of food){
    // draw as a black circle
    let screenCoord = scale(f.pos, canvas);
    let radius = 3;
    ctx.moveTo(screenCoord[0] + radius, screenCoord[1]);
    ctx.arc(screenCoord[0], screenCoord[1], radius, 0, Math.PI*2);
  }
  ctx.fill();

  for(let f of fish){
    // make the fish grayer as its health decreases
    // map [0, 100] -> [0, .44]
    let hue = .44 / (1 + Math.E**(-3*(f.health - .5)));
    let rgb = HSVtoRGB(hue, 1, .7);
    ctx.strokeStyle = 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')';
    ctx.beginPath();

    let middle = scale(f.pos, canvas);
    let majorAxis = normalize(sub(scale([Math.cos(f.angle), Math.sin(f.angle)], canvas), scale([0,0], canvas) ));
    let minorAxis = [-majorAxis[1], majorAxis[0]];
    let screenAngle = Math.atan2(majorAxis[1], majorAxis[0]);
    // draw an oval in the direction of the fish. This can be represented as an arc plus two straight lines
    let radius = norm(sub(scale([0,0],canvas),scale([environment.foodPickupRadius, 0],canvas)));
    let length = 3*radius;
    let corner1 = add(add(middle, scalar(-radius,minorAxis)), scalar(length/2, majorAxis));
    ctx.moveTo(...corner1);
    let corner2 = add(add(middle, scalar(-radius,minorAxis)), scalar(-length/2, majorAxis));
    ctx.lineTo(...corner2);
    ctx.arc(...add(middle, scalar(-length/2,majorAxis)), radius, screenAngle-Math.PI/2, screenAngle+Math.PI/2, true);
    ctx.lineTo(...add(corner1, scalar(2*radius, minorAxis)));
    ctx.arc(...add(middle, scalar(length/2, majorAxis)), radius,  screenAngle+Math.PI/2, screenAngle-Math.PI/2, true);
    ctx.stroke();
  }
}

function initWorkers(){
  // number of cores
  for(let i = 0; i < window.navigator.hardwareConcurrency - 1; i++){
    workers.push({
      worker:new Worker('./fish_worker.js'),
      fish:[]
    });
  }
}

function addFishToWorker(f){
  // find the worker with the least amount of fish
  let leastWorker = workers[0];
  for(let j = 1; j < workers.length; j++){
    let w = workers[j];
    if(w.fish.length < leastWorker.fish.length){
      leastWorker = w;
    }
  }
  // post a message to the worker
  leastWorker.fish.push(f);
  f.worker = leastWorker;
  let arrayNetwork = [];
  for(layer of f.network.layers){
    arrayNetwork.push(layer.toArray());
  }
  leastWorker.worker.postMessage(['add_fish', f.id, arrayNetwork, environment.network.usableOutputValues]);
}

function removeFishFromWorker(f){
  f.worker.worker.postMessage(['delete_fish', f.id]);
  // remove f from worker.fish
  for(let i = 0; i < f.worker.fish.length; i++){
    if(f.worker.fish[i] === f){
      f.worker.fish.splice(i,1);
    }
  }
}

function saveFish(f){

}

function initFood(){
  // start off with a healthy 100 food or so
  for(let i = 0; i < environment.initialFoodCount; i++){
    food.push(randFood());
  }
}

function randFood(){
  let randPos = [Math.random(), Math.random()];
  return {
    pos: randPos,
    pickupRadius: environment.foodPickupRadius,
    magnitude: .5,
    eaten:false
  }
}

function initFish(){
  let previousDNA = [];

  // start off with 10 random fish
  for(let i = 0; i < environment.initialFishCount; i++){
    addRandFish();
  }
}

let global_id = 0;
function nextID(){
  global_id++;
  return global_id;
}

function addRandFish(){
  let randPos = [Math.random(), Math.random()];
  let randAngle = Math.random()*Math.PI*2;
  let randDNA = [];
  for(let j = 0; j < environment.network.width**2 * (environment.network.depth - 1); j++){
    randDNA.push(Math.random()*2 - 1+.1);
  }
  let newFish = {
    pos: randPos,
    vel: .1,
    angle:randAngle,
    angularVel: 1,
    acc:0,
    angAcc:0,
    health: 1,
    dna: randDNA,
    age:0,
    generation:0,
    id:nextID(),
    network: {}
  };
  newFish.network = dnaToNetwork(newFish.dna);
  addFishToWorker(newFish);
  fish.push(newFish);
}

function dnaToNetwork(dna){
  // the dna has length equal to the number of edges. First we separate into layers
  let rawLayers = [];
  let layerWidth = environment.network.width**2;
  for(let i = 0; i < environment.network.depth - 1; i++){
    rawLayers.push(dna.slice(i*layerWidth, i*layerWidth+layerWidth));
  }
  // each layer is a environment.network.width x environment.network.width array of numbers
  let layers = [];
  for(let sub of rawLayers){
    // array of subLayers
    let rows = []
    let subLayer = [];
    let count = 0;
    for(let el of sub){
      subLayer.push(el);
      count += 1;
      if(count === environment.network.width){
        rows.push(subLayer);
        subLayer = [];
        count = 0;
      }
    }

    layers.push(new Matrix(rows));
  }
  return {layers:layers};
}

function getFish(f){

  // deals with boundary conditions (aka a fish on the left side of the screen appears to
  // the right of a fish on the right side of the screen.)
  function offsetPos(z){
    let offset = sub(z.pos, f.pos);
    if(Math.abs(offset[0]) > .5){
      if(f.pos[0] < .5){
        offset[0] = -(1 - z.pos[0] + f.pos[0]);
      }else{
        offset[0] = z.pos[0] + (1-f.pos[0]);
      }
    }
    if(Math.abs(offset[1]) > .5){
      if(f.pos[1] < .5){
        offset[1] = -(1 - z.pos[1] + f.pos[1]);
      }else{
        offset[1] = z.pos[1] + (1-f.pos[1]);
      }
    }
    return offset;
  }

  let sortedFish = fish.slice().sort((a,b) => {
    return norm(offsetPos(a)) - norm(offsetPos(b));
  });

  // find the nearest numFish fish
  let foodWithinSquare = food.filter(x => norm(offsetPos(x)) <= environment.foodSightRadius);
  let sortedFood = foodWithinSquare.sort((a,b) => {
    return norm(offsetPos(a)) - norm(offsetPos(b));
  });

  // we'll need sortedFood for later
  f.sortedFood = sortedFood;

  let numFish = Math.floor(environment.network.fishWidth / 6);
  let numFood = Math.floor(environment.network.foodWidth / 3);
  // compile our input
  // food

  function relativePos(z){
    // find a location relative to the major axis of the fish
    // given  axis1=v1, axus2=v2, find a, b so that
    // z =  a v1 + b v2
    // this is a linear system
    let v1 = scalar(environment.foodSightRadius, [Math.cos(f.angle), Math.sin(f.angle)]);
    // v2 is arbitrary since the fish can learn one way or another
    let v2 = [-v1[1], v1[0]];
    let det =  v1[1]*v2[0] - v1[0]*v2[1];
    if(det === 0){
      return [0,0];
    }
    return [
      -(v2[1]*z[0]-v2[0]*z[1])/det,
      -(-v1[1]*z[1]+v1[0]*z[1])/det
    ]
  }

  // all inputs should be in range [-1, 1]

  let input = [];
  for(let j = 0; j < numFood && j < f.sortedFood.length; j++){
    let foodEl = f.sortedFood[j];
    // food magnitude likely to be [0,1]
    input.push(...relativePos(offsetPos(foodEl)), foodEl.magnitude*2 - 1);
  }
  // buffer till next input
  while(input.length < environment.network.fishStart - 1){
    input.push(0);
  }
  // fish
  for(let j = 0; j < numFish && j < sortedFish.length; j++){
    let fishEl = sortedFish[j];
    // health in [0, 2]
    input.push(...relativePos(offsetPos(fishEl)),fishEl.health - 1);
  }
  // buffer
  while(input.length < environment.network.selfStart){
    input.push(0);
  }
  // self
  // health in [0,2]
  input.push(f.health - 1);
  let i = 2;
  // add previous output to buffer as necessary
  while(input.length < environment.network.width && i < f.networkOutput.length){
    input.push(f.networkOutput[i]);
    i++;
  }
  // buffer
  while(input.length < environment.network.width){
    input.push(0);
  }
  return input;
}

function add(a,b){
  let res = [];
  for(let i=0;i<a.length;i++){
    res.push(a[i] + b[i]);
  }
  return res;
}
function neg(a){
  return a.map(x => -x);
}
function sub(a,b){
  return add(neg(b), a);
}
function norm(a){
  let res = 0;
  for(let i=0;i<a.length;i++){
    res += a[i]**2;
  }
  return Math.sqrt(res);
}
function normalize(a){
  return scalar(1/norm(a), a);
}
function scalar(m, a){
  return a.map(x => m*x);
}

// https://stackoverflow.com/questions/17242144/javascript-convert-hsb-hsv-color-to-rgb-accurately
function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h.s, v = h.v, h = h.h;
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}
