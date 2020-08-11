const Noodl = require('@noodl/noodl-sdk');

const MyFullNameNode = Noodl.defineNode({
	category:'My Utils',
	name:'Full Name',
	inputs:{
		FirstName:'string',
		LastName:'string'
	},
	outputs:{
		FullName:'string'
	},
	changed:{
		FirstName:function() {
			this.setOutputs({FullName:this.inputs.FirstName + ' ' + this.inputs.LastName});
		},
		LastName:function() {
			this.setOutputs({FullName:this.inputs.FirstName + ' ' + this.inputs.LastName});
		},		
	}
})

Noodl.defineModule({
    nodes:[
		MyFullNameNode
    ],
    setup() {
    	//this is called once on startup
    }
});