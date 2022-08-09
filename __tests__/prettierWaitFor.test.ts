let code = `async() => {
    await(0, wait_for_expect.default)()) => {
            console.log(1);
        });
}`

//@ts-ignore
code = code.split(/(expect[\S\s.]*)/g)
const check = code[0].includes('wait_for_') ? '' : '\n'

//@ts-ignore
code = code.join(check);

//code = prettier.format(code, {parser: 'typescript', plugins: [parser]});
	
console.log(code)