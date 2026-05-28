import socketio
import asyncio
import random

sio = socketio.AsyncClient()

async def drive_around():

    # Connect to running FastAPI server
    await sio.connect('http://127.0.0.1:8000')
    print("Police Car Simulator Connected!")

    # Starting coordinates for Car_101
    current_lat = 51.9244
    current_lng = 4.4777

    print("Starting patrol")
    
    # Send 5 location updates, moving slightly each time
    for i in range(5):
        # Simulate the car driving by slightly changing the coordinates
        current_lat += random.uniform(-0.005, 0.005)
        current_lng += random.uniform(-0.005, 0.005)
        
        # Send the data to the server's new 'update_location' listener
        await sio.emit('update_location', {
            'car_id': 'Car_101', 
            'lat': current_lat, 
            'lng': current_lng
        })
        
        # Wait 3 seconds before sending the next GPS ping
        await asyncio.sleep(3)
        
    print("Patrol finished. Disconnecting.")
    await sio.disconnect()

if __name__ == '__main__':
    asyncio.run(drive_around())