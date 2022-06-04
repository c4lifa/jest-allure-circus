describe('beforeEach hook exception', () => {
    let i = 0

    beforeEach(() => {
        if(i == 1) {
            i++;
            throw new Error('before each exception')
        }
        i++;
    })
    
    it('my test', () => {
        expect(1+1).toBe(2)
    })

    it('my test2', () => {
        expect(1+1).toBe(2)
    })

    it('my test3', () => {
        expect(1+1).toBe(2)
    })
})