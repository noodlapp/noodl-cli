const Noodl = require('@noodl/noodl-sdk');

function MyCustomReactComponent(props) {
	const style = {
		color: props.textColor,
		backgroundColor: props.backgroundColor,
		borderRadius: '10px',
		padding: '20px',
		marginBottom: props.marginBottom
	};

	return <div style={style} onClick={props.onClick} >{props.children}</div>
}

const MyCustomReactComponentNode = Noodl.defineReactNode({
	name: 'Custom React Component',
	category: 'Tutorial',
	getReactComponent() {
		return MyCustomReactComponent;
	},
	inputProps: {
		backgroundColor: {type: 'color', default: 'white'},
		marginBottom: {type: {name: 'number', units: ['px'], defaultUnit: 'px'}, default: 10}
	},
	outputProps: {
		onClick: {type: 'signal', displayName: 'Click'}
	}
})


Noodl.defineModule({
    reactNodes: [
    	MyCustomReactComponentNode
    ],
    nodes:[
    ],
    setup() {
    	//this is called once on startup
    }
});