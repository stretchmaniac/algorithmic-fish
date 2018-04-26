// import our matrix library
self.importScripts('libs/vectorious.min.js');

// in a web worker, fish are just a network, and getting fish data involves evaluating the
// neural network of the fish with the given input
let fishAssignment = [];

onmessage = function(e){
  let data = e.data;
  let messageType = data[0];
  if(messageType === 'add_fish'){
    let arrayNetwork = data[2];
    let network = {layers:[]};
    for(let a of arrayNetwork){
      network.layers.push(new Matrix(a));
    }
    // we need an identifier for the fish and the network information
    let newFish = {
      id: data[1],
      network: network,
      outputLength: data[3]
    };
    fishAssignment.push(newFish);
  }else if(messageType === 'delete_fish'){
    // search through the fish and delete the one with the matching id
    let id = data[1];
    let idFound = false;
    for(let i = 0; i < fishAssignment.length; i++){
      if(fishAssignment[i].id === id){
        fishAssignment.splice(i,1);
        idFound = true;
        break;
      }
    }

    if(idFound === false){
      console.log('ERROR: id not found when deleting fish');
    }

  }else if(messageType === 'get_fish_data'){
    let inputs = data[1];

    // we assume good bookkeeping and that the number of inputs
    // is equal to the number in the fish assignment, and that they correspond exactly
    let outputs = [];
    for(let i = 0; i < inputs.length; i++){
      // find fish with correct id
      let fish = null;
      for(let f of fishAssignment){
        if(f.id === inputs[i].id){
          fish = f;
          break;
        }
      }
      // we preserve the order of the inputs in the outputs
      outputs.push(evaluateNetwork(fish.network, inputs[i].data).slice(fish.outputLength));
    }

    postMessage(outputs);
  }
}

function evaluateNetwork(network, input){
  let layers = network.layers;

  function activationFunction(val){
    // sigmoid function
    return 2 / (1 + Math.E**(-val)) - 1;
  }

  let matInput = (new Matrix([input])).transpose();

  for(let layer of layers){
    matInput = Matrix.multiply(layer, matInput);
    matInput = matInput.map(x => activationFunction(x));
  }
  return matInput.transpose().toArray()[0];
}
